"""Moteur d'échéances — Rule Engine (regles.py) + Decision Engine (moteur.py) + Scheduler (dates.py).

Couvre ce que l'intégration doit préserver :
  • une obligation absente du profil (franchise TVA, pas de client UE) n'apparaît JAMAIS ;
  • le statut passe de a_venir → urgent → en_retard selon la date, jamais l'inverse sans action ;
  • "regularisee" (vert) n'a qu'une seule origine : marquer_regularisee (déclaratif, jamais déduit) ;
  • une date "jour ouvré"/zone inconnue reste une fenêtre indicative — jamais un jour inventé ;
  • un régime non reconnu (réel/société) renvoie une liste vide, jamais une erreur.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents.echeancier import dates as sch
from app.agents.echeancier import moteur, regles, store
from app.schemas.orchestrator import UserProfile


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(store, "get_db", lambda: client["ledgermind_test"])
    yield


def _profil_micro(**overrides) -> UserProfile:
    base = dict(
        siren="123456789", denomination="Julie Martin", recommended_regime="micro-BNC",
        verification_status="verified",
    )
    base.update(overrides)
    return UserProfile(**base)


def test_regime_non_reconnu_renvoie_liste_vide():
    profil = UserProfile(recommended_regime="societe", verification_status="verified")
    assert moteur.generer_agenda("u1", profil) == []


def test_franchise_tva_aucune_echeance_tva():
    profil = _profil_micro(regime_tva="franchise")
    echeances = moteur.generer_agenda("u1", profil)
    assert not any("TVA" in e.libelle or "tva" in e.obligation_id for e in echeances)


def test_regime_tva_inconnu_aucune_echeance_tva_mais_signale_manquant():
    profil = _profil_micro()  # regime_tva=None
    echeances = moteur.generer_agenda("u1", profil)
    assert not any("tva" in e.obligation_id for e in echeances)
    assert "regime_tva" in moteur.parametres_manquants(profil)


def test_reel_simplifie_genere_les_trois_echeances_tva():
    profil = _profil_micro(regime_tva="reel_simplifie")
    ids = {e.obligation_id for e in moteur.generer_agenda("u1", profil)}
    assert {"tva_acompte_juillet", "tva_acompte_decembre", "tva_ca12_annuelle"} <= ids


def test_pas_de_client_ue_aucune_des():
    profil = _profil_micro(revenus_intracommunautaires=False)
    echeances = moteur.generer_agenda("u1", profil)
    assert not any(e.obligation_id == "des" for e in echeances)


def test_client_ue_genere_une_echeance_des_en_fenetre_indicative():
    profil = _profil_micro(revenus_intracommunautaires=True)
    des = next(e for e in moteur.generer_agenda("u1", profil) if e.obligation_id == "des")
    assert des.date_limite is None
    assert "10" in des.fenetre_indicative


def test_toujours_une_echeance_urssaf_et_ir_annuelle():
    profil = _profil_micro()
    ids = {e.obligation_id for e in moteur.generer_agenda("u1", profil)}
    assert {"urssaf_cotisations", "ir_annuelle_2042"} <= ids


def test_ir_annuelle_reste_une_fenetre_indicative_jamais_une_date_inventee():
    profil = _profil_micro()
    ir = next(e for e in moteur.generer_agenda("u1", profil) if e.obligation_id == "ir_annuelle_2042")
    assert ir.date_limite is None
    assert ir.fenetre_indicative is not None


def test_cfe_exoneree_annee_de_creation():
    profil = _profil_micro(creation_date=date.today().isoformat())
    ids = {e.obligation_id for e in moteur.generer_agenda("u1", profil)}
    assert "cfe" not in ids


def test_cfe_due_le_15_decembre_hors_annee_de_creation():
    profil = _profil_micro(creation_date="2020-01-01")
    cfe = next(e for e in moteur.generer_agenda("u1", profil) if e.obligation_id == "cfe")
    assert cfe.date_limite is not None
    assert cfe.date_limite.endswith("-12-15") or cfe.date_limite[-2:] in ("15", "16", "17")


def test_statut_urgent_puis_retard_selon_la_date():
    limite = date(2026, 7, 31)
    _, palier_loin = sch.statut_et_palier(limite, date(2026, 6, 1), regularisee=False)
    statut_proche, _ = sch.statut_et_palier(limite, date(2026, 7, 25), regularisee=False)
    statut_retard, palier_retard = sch.statut_et_palier(limite, date(2026, 8, 1), regularisee=False)
    assert palier_loin is None
    assert statut_proche == "urgent"
    assert statut_retard == "en_retard" and palier_retard == "retard"


def test_marquer_regularisee_est_le_seul_chemin_vers_vert():
    profil = _profil_micro()
    avant = next(e for e in moteur.generer_agenda("u1", profil) if e.obligation_id == "urssaf_cotisations")
    assert avant.statut != "regularisee"
    store.marquer_regularisee("u1", "urssaf_cotisations", avant.periode)
    apres = next(e for e in moteur.generer_agenda("u1", profil) if e.obligation_id == "urssaf_cotisations")
    assert apres.statut == "regularisee"


def test_regularisation_isolee_par_utilisateur():
    store.marquer_regularisee("u1", "urssaf_cotisations", "juillet 2026")
    assert store.est_regularisee("u1", "urssaf_cotisations", "juillet 2026") is True
    assert store.est_regularisee("u2", "urssaf_cotisations", "juillet 2026") is False


def test_regle_inconnue_ne_leve_pas_erreur():
    assert regles.obligations_pour_regime("reel_normal_societe_inexistant") == []
