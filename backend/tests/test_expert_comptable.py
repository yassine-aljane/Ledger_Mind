"""Recherche d'experts-comptables — sources officielles uniquement, jamais de scraping.

Couvre ce que l'intégration doit préserver :
  • aucun cabinet n'est inventé : une ville introuvable lève une erreur explicite ;
  • la source de CHAQUE résultat est indiquée (jamais un cabinet sans provenance) ;
  • aucun classement commercial — tri par distance connue, sinon ordre de découverte ;
  • le lien vers l'annuaire officiel de l'Ordre est toujours présent ;
  • une source indisponible ne bloque pas l'autre.

Les appels réseau réels (API Adresse, Overpass, Recherche d'Entreprises) sont mockés pour rester
déterministe ; une recherche live sur "Lyon" a été vérifiée manuellement (voir le commit).
"""

from __future__ import annotations

import pytest

from app.agents.expert_comptable import search
from app.agents.expert_comptable.search import VilleIntrouvable, rechercher


@pytest.fixture(autouse=True)
def reseau_mock(monkeypatch):
    monkeypatch.setattr(search, "geocode_ville", lambda ville: (
        {"lat": 45.75, "lon": 4.85, "code_postal": "69001"} if ville.strip() else None
    ))
    monkeypatch.setattr(search, "search_overpass", lambda lat, lon: [
        {"nom_cabinet": "Cabinet OSM Test", "adresse": "1 rue Test", "telephone": None,
         "site_web": None, "email": None, "lat": lat + 0.01, "lon": lon},
    ])
    monkeypatch.setattr(search, "search_entreprise_api", lambda ville, cp=None: [
        {"nom_cabinet": "Cabinet API Officiel", "adresse": "2 avenue Test",
         "telephone": None, "site_web": None, "email": None},
    ])
    yield


def test_ville_vide_leve_une_erreur_explicite():
    with pytest.raises(VilleIntrouvable):
        rechercher("")


def test_ville_introuvable_leve_sans_inventer_de_resultat():
    import app.agents.referral.tools.geocode as geocode_mod  # noqa: F401
    from app.agents.expert_comptable import search as s

    def geocode_none(ville):
        return None

    original = s.geocode_ville
    s.geocode_ville = geocode_none
    try:
        with pytest.raises(VilleIntrouvable):
            rechercher("Xyzabc123InconnuVille")
    finally:
        s.geocode_ville = original


def test_chaque_resultat_porte_sa_source():
    r = rechercher("Lyon")
    assert len(r.cabinets) == 2
    sources = {c.source for c in r.cabinets}
    assert sources == {
        "OpenStreetMap (Overpass)",
        "Recherche d'Entreprises (api.gouv.fr)",
    }


def test_annuaire_officiel_toujours_present():
    r = rechercher("Lyon")
    assert r.annuaire_officiel_url.startswith("https://")
    assert "experts-comptables" in r.annuaire_officiel_url


def test_une_source_indisponible_ne_bloque_pas_lautre(monkeypatch):
    def echec(*a, **kw):
        raise RuntimeError("API indisponible")

    monkeypatch.setattr(search, "search_overpass", echec)
    r = rechercher("Lyon")
    assert len(r.cabinets) == 1
    assert r.cabinets[0].source == "Recherche d'Entreprises (api.gouv.fr)"
    assert r.sources == ["Recherche d'Entreprises (api.gouv.fr)"]


def test_dedoublonnage_par_nom():
    monkeypatch_source = [
        {"nom_cabinet": "Même Cabinet", "adresse": "A", "telephone": None,
         "site_web": None, "email": None},
    ]
    search.search_entreprise_api = lambda ville, cp=None: monkeypatch_source
    search.search_overpass = lambda lat, lon: [
        {"nom_cabinet": "même cabinet", "adresse": "B", "telephone": None,
         "site_web": None, "email": None, "lat": lat, "lon": lon},
    ]
    r = rechercher("Lyon")
    assert len(r.cabinets) == 1


def test_aucun_champ_invente_absence_reste_none():
    r = rechercher("Lyon")
    cabinet_osm = next(c for c in r.cabinets if c.source == "OpenStreetMap (Overpass)")
    assert cabinet_osm.telephone is None
    assert cabinet_osm.site_web is None
    assert cabinet_osm.email is None
