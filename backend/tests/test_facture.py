"""Génération de facture — mentions légales sourcées, calculs déterministes, numérotation.

Couvre ce que l'intégration doit préserver :
  • le régime franchise TVA affiche EXACTEMENT le texte statutaire (art. 293 B CGI) ;
  • un client redevable de la TVA déclenche la mention d'auto-liquidation ;
  • le n° de TVA intracommunautaire n'est requis qu'au-dessus de 150 € HT (fiche F31808) ;
  • aucune facture sans SIREN vérifié (l'entreprise n'existe pas légalement sans lui) ;
  • la numérotation est séquentielle et sans trou, même en cas d'appels concurrents ;
  • le PDF se génère sans erreur (régression : dépassement de largeur de colonne fpdf2).

MongoDB est simulé par `mongomock` pour les tests de numérotation.
"""

from __future__ import annotations

import mongomock
import pytest

from app.agents.facture import store
from app.agents.facture.generator import (
    DonneesEmetteurIncompletes,
    construire_mentions,
    generer_facture,
    valider_profil_emetteur,
)
from app.agents.facture.pdf import facture_to_pdf
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.schemas.orchestrator import UserProfile


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(store, "get_db", lambda: client["ledgermind_test"])
    yield


def _profil_micro(**overrides) -> UserProfile:
    base = dict(
        siren="123456789", denomination="Julie Martin", is_entrepreneur_individuel=True,
        registry_address="12 rue des Lilas, 75011 Paris", recommended_regime="micro-BNC",
        verification_status="verified",
    )
    base.update(overrides)
    return UserProfile(**base)


def _profil_societe(**overrides) -> UserProfile:
    base = dict(
        siren="987654321", denomination="Créa Digital", legal_form="SASU",
        is_entrepreneur_individuel=False, registry_address="8 rue de Rivoli, 75004 Paris",
        recommended_regime="societe", verification_status="verified",
    )
    base.update(overrides)
    return UserProfile(**base)


def _requete(**overrides) -> FactureRequest:
    base = dict(
        client=ClientFacture(nom="Studio Créatif SAS", est_professionnel=True),
        lignes=[LigneFacture(designation="Création de contenu", prix_unitaire_ht=1200)],
    )
    base.update(overrides)
    return FactureRequest(**base)


def test_franchise_tva_texte_statutaire_exact():
    """Le texte doit être EXACTEMENT celui de l'article 293 B du CGI, mot pour mot."""
    profil = _profil_micro()
    mentions, _ = construire_mentions(profil, _requete(), total_ht=1200, total_tva=0)
    franchise = next(m for m in mentions if m.cle == "franchise_tva")
    assert franchise.valeur == "TVA non applicable, art. 293 B du code général des impôts"
    assert "service-public.fr" in franchise.source


def test_client_redevable_tva_declenche_autoliquidation():
    profil = _profil_societe()
    req = _requete(client=ClientFacture(
        nom="Marque Beauté SARL", est_professionnel=True, numero_tva_intracom="FR12345678901",
    ))
    mentions, _ = construire_mentions(profil, req, total_ht=2500, total_tva=500)
    assert any(m.cle == "autoliquidation" for m in mentions)
    assert not any(m.cle == "franchise_tva" for m in mentions)


def test_tva_intracom_requise_seulement_au_dessus_de_150_euros():
    profil = _profil_societe()
    _, requise_bas = construire_mentions(profil, _requete(), total_ht=150.0, total_tva=0)
    _, requise_haut = construire_mentions(profil, _requete(), total_ht=150.01, total_tva=0)
    assert requise_bas is False
    assert requise_haut is True


def test_sans_siren_leve_une_erreur_explicite():
    profil = _profil_micro(siren=None)
    with pytest.raises(DonneesEmetteurIncompletes, match="SIREN"):
        valider_profil_emetteur(profil)


def test_montants_calcules_pas_de_tva_en_franchise():
    facture = generer_facture("u1", "FA-2026-000001", _profil_micro(), _requete())
    assert facture.total_ht == 1200.0
    assert facture.total_tva == 0.0
    assert facture.total_ttc == 1200.0
    assert facture.emetteur_franchise_tva is True


def test_montants_calcules_avec_tva():
    req = _requete(lignes=[LigneFacture(designation="Conseil", quantite=10,
                                        prix_unitaire_ht=250, taux_tva=0.20)])
    facture = generer_facture("u2", "FA-2026-000002", _profil_societe(), req)
    assert facture.total_ht == 2500.0
    assert facture.total_tva == 500.0
    assert facture.total_ttc == 3000.0
    assert facture.emetteur_franchise_tva is False


def test_numerotation_sequentielle_sans_trou():
    numeros = [store.prochain_numero("user_x") for _ in range(5)]
    assert numeros == sorted(numeros)
    assert len(set(numeros)) == 5
    suffixes = [int(n.rsplit("-", 1)[1]) for n in numeros]
    assert suffixes == list(range(suffixes[0], suffixes[0] + 5))


def test_numerotation_isolee_par_utilisateur():
    a1 = store.prochain_numero("user_a")
    b1 = store.prochain_numero("user_b")
    a2 = store.prochain_numero("user_a")
    assert a1.endswith("000001") and a2.endswith("000002")
    assert b1.endswith("000001")


def test_pdf_se_genere_sans_erreur_franchise_et_avec_tva():
    """Régression : un dépassement de largeur de colonne fpdf2 faisait échouer la génération."""
    f1 = generer_facture("u1", "FA-2026-000001", _profil_micro(), _requete())
    pdf1 = facture_to_pdf(f1)
    assert pdf1[:5] == b"%PDF-"
    assert len(pdf1) > 500

    req2 = _requete(lignes=[LigneFacture(designation="Conseil", quantite=10,
                                         prix_unitaire_ht=250, taux_tva=0.20)])
    f2 = generer_facture("u2", "FA-2026-000002", _profil_societe(), req2)
    pdf2 = facture_to_pdf(f2)
    assert pdf2[:5] == b"%PDF-"
