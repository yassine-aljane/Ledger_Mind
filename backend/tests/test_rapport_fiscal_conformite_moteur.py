"""Conformité du rapport à la spécification du moteur fiscal (France, 2026).

La spécification exige que le rapport expose **toutes** les étapes du calcul, pas seulement
son résultat. Un chiffre sans le taux qui l'a produit ni la source de ce taux n'est pas
vérifiable — et un rapport fiscal non vérifiable ne vaut rien devant un contrôle.

Ce que ces tests protègent :

  • la **catégorie fiscale** apparaît : elle commande abattement, cotisations, CFP,
    versement libératoire et plafond ;
  • le **plafond du régime** est contrôlé et son état donné, conforme ou non ;
  • les **seuils de TVA** sont signalés, jamais calculés ;
  • le calcul est **toujours effectué**, y compris à CA nul — zéro est un résultat ;
  • le **taux effectif** n'est jamais une division par zéro ;
  • barème et **versement libératoire** sont comparés, ou l'impossibilité est dite ;
  • le statut **ACRE** et le **prorata** de première année sont explicites ;
  • les **constantes appliquées** sont affichées avec leur provenance.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents.impots import tools as moteur
from app.agents.rapport_fiscal import acre as acre_flag
from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal import sources, store, tva as tva_flag
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport
from app.schemas.orchestrator import UserProfile

UID = "u1"
_FACTURES: list = []


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["testdb"]
    for module in (O, sources, store):
        monkeypatch.setattr(module, "get_db", lambda: db)
    monkeypatch.setattr(store, "_initialized", False)
    monkeypatch.setattr(O, "_factures_avec_existence_fiscale", lambda uid: _FACTURES)
    _FACTURES.clear()
    yield db
    _FACTURES.clear()


def _facture(numero: str, net: float, categorie="prestation"):
    _FACTURES.append({
        "id": f"id-{numero}", "numero": numero, "net_a_payer": net,
        "total_ht": net, "total_ttc": net, "date_emission": "2026-03-01",
        "date_echeance": "2026-03-31", "client": {"nom": "Client SARL"},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie}],
    })


def _virement(db, doc_id: str, montant: float, motif: str):
    db["virements"].insert_one({
        "user_id": UID, "document_id": doc_id,
        "transfer": {"amount": montant, "direction": "recu",
                     "execution_date": "2026-03-15", "motif": motif,
                     "sender_name": "Client SARL"},
    })


def _generer(contexte=None, profil=None, debut="2026-01-01", fin="2026-12-31"):
    return O.generer(
        UID,
        DemandeRapport(date_debut=debut, date_fin=fin,
                       contexte=contexte or ContexteFiscalRapport()),
        profil=profil,
    )


# -- §1 Catégorie fiscale affichée -------------------------------------------
def test_la_categorie_fiscale_appliquee_est_affichee(mongo):
    """Sans elle, aucun des taux du rapport n'est vérifiable."""
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    rapport = _generer(ContexteFiscalRapport(categorie_par_defaut="BNC"))
    assert rapport.categories_fiscales == ["BNC"]


def test_l_activite_mixte_affiche_ses_deux_categories(mongo):
    _facture("FA-2026-000001", 20000.0, categorie="vente")
    _facture("FA-2026-000002", 10000.0, categorie="prestation")
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")
    _virement(mongo, "v2", 10000.0, "FA-2026-000002")

    assert set(_generer().categories_fiscales) == {"BIC_VENTE", "BNC"}


def test_la_categorie_est_affichee_meme_sans_encaissement(mongo):
    assert _generer(ContexteFiscalRapport(categorie_par_defaut="BIC_SERVICE")) \
        .categories_fiscales == ["BIC_SERVICE"]


# -- §2 Contrôle du plafond du régime micro ----------------------------------
def test_le_plafond_est_donne_meme_quand_il_est_respecte(mongo):
    """« Conforme » est une information : n'afficher que les dépassements laisse un doute."""
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    plafonds = _generer().plafonds
    ligne = plafonds["plafonds"][0]

    assert ligne["conforme"] is True
    assert ligne["plafond"] > 0
    assert ligne["marge_restante"] == pytest.approx(ligne["plafond"] - 20000.0, abs=0.01)
    assert plafonds["au_dessus_du_plafond"] is False


def test_un_depassement_est_signale_sans_conclure_a_la_sortie(mongo):
    _facture("FA-2026-000001", 90000.0)
    _virement(mongo, "v1", 90000.0, "FA-2026-000001")

    rapport = _generer()
    assert rapport.plafonds["au_dessus_du_plafond"] is True
    assert rapport.plafonds["plafonds"][0]["conforme"] is False
    assert "deux années consécutives" in rapport.plafonds["note"]


def test_le_plafond_est_proratise_la_premiere_annee(mongo):
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    plein = _generer().plafonds["plafonds"][0]
    partiel = _generer(ContexteFiscalRapport(jours_activite=90)).plafonds["plafonds"][0]

    assert partiel["plafond_proratise"] is True
    assert plein["plafond_proratise"] is False
    assert partiel["plafond"] == pytest.approx(plein["plafond"] * 90 / 365, abs=0.05)


# -- §3 Seuils de TVA : signalés, jamais calculés ----------------------------
def test_le_statut_de_tva_est_explicite_meme_sans_depassement(mongo):
    _facture("FA-2026-000001", 10000.0)
    _virement(mongo, "v1", 10000.0, "FA-2026-000001")

    tva = _generer().tva
    assert tva["statut"] == "franchise_conservee"
    assert "conservée" in tva["libelle_statut"]


def test_le_statut_distingue_seuil_de_base_et_seuil_majore(mongo):
    bloc = tva_flag.seuils_tva()["services"]

    base = tva_flag.statut_franchise({"prestation": bloc["seuil_base"] + 100})
    majore = tva_flag.statut_franchise({"prestation": bloc["seuil_majore"] + 100})

    assert base["statut"] == "seuil_base_depasse"
    assert majore["statut"] == "seuil_majore_depasse"


def test_aucune_tva_n_est_jamais_chiffree(mongo):
    _facture("FA-2026-000001", 60000.0)
    _virement(mongo, "v1", 60000.0, "FA-2026-000001")

    tva = _generer().tva
    assert not any(cle.startswith("montant") or cle == "tva_due" for cle in tva)


# -- §4 et §10 Calcul toujours effectué, message honnête à CA nul ------------
def test_tous_les_postes_sont_presents_a_ca_nul(mongo):
    sim = _generer().simulation
    for poste in ("base_imposable", "cotisations_sociales", "cfp", "total_prelevements",
                  "revenu_net_estime", "lignes"):
        assert poste in sim, f"{poste} doit figurer même à CA nul"
    assert sim["base_imposable"] == 0.0
    assert sim["cotisations_sociales"] == 0.0
    assert sim["cfp"] == 0.0
    assert sim["lignes"][0]["abattement"] == 0.0


def test_le_message_a_ca_nul_ne_parle_pas_d_absence_de_calcul(mongo):
    texte = " ".join(_generer().hypotheses)
    assert "aucun calcul n'a été effectué" not in texte
    assert "ont bien été effectués" in texte
    assert "déclaration reste obligatoire" in texte


# -- §5 Taux effectif --------------------------------------------------------
def test_le_taux_effectif_est_calcule_quand_le_ca_est_positif(mongo):
    _facture("FA-2026-000001", 40000.0)
    _virement(mongo, "v1", 40000.0, "FA-2026-000001")

    sim = _generer(ContexteFiscalRapport(parts_fiscales=1.0, autres_revenus=0.0)).simulation
    assert sim["taux_effectif"] is not None
    assert 0 < sim["taux_effectif"] < 1


def test_le_taux_effectif_reste_nul_sans_division_par_zero(mongo):
    """`None` se lit « non applicable » ; un 0 se lirait « aucun prélèvement »."""
    assert _generer().simulation["taux_effectif"] is None


# -- §6 Comparaison barème / versement libératoire ---------------------------
def test_les_deux_options_sont_chiffrees_quand_c_est_possible(mongo):
    _facture("FA-2026-000001", 42000.0)
    _virement(mongo, "v1", 42000.0, "FA-2026-000001")

    sim = _generer(ContexteFiscalRapport(
        parts_fiscales=1.0, autres_revenus=0.0, rfr_n2=20000.0,
    )).simulation

    assert sim["ir_bareme"] is not None
    assert sim["versement_liberatoire"]["montant"] is not None
    assert sim["versement_liberatoire"]["eligible"] is True
    assert sim["recommandation"], "l'option la moins coûteuse doit être nommée"


def test_l_impossibilite_de_comparer_est_dite(mongo):
    _facture("FA-2026-000001", 42000.0)
    _virement(mongo, "v1", 42000.0, "FA-2026-000001")

    rapport = _generer()  # ni parts, ni autres revenus, ni RFR N-2
    assert rapport.ir_calculable is False
    assert rapport.simulation["versement_liberatoire"]["eligible"] is None
    titres = " ".join(a.titre for a in rapport.alertes)
    assert "libératoire" in titres and "revenu" in titres.lower()


def test_un_rfr_trop_eleve_rend_le_versement_liberatoire_ineligible(mongo):
    _facture("FA-2026-000001", 42000.0)
    _virement(mongo, "v1", 42000.0, "FA-2026-000001")

    sim = _generer(ContexteFiscalRapport(
        parts_fiscales=1.0, autres_revenus=0.0, rfr_n2=500000.0,
    )).simulation
    assert sim["versement_liberatoire"]["eligible"] is False
    assert sim["versement_liberatoire"]["motif_ineligibilite"]


# -- §7 Statut ACRE ----------------------------------------------------------
def test_l_acre_inactive_est_dite_telle_quelle(mongo):
    etat = _generer().acre
    assert etat["active"] is False
    assert etat["reduction_pourcent"] > 0, "le taux reste affiché pour information"


def test_l_acre_active_annonce_sa_reduction_et_sa_duree_restante(mongo):
    profil = UserProfile(acre_active=True, acre_start_date="2026-01-15")
    rapport = _generer(ContexteFiscalRapport(acre_active=True), profil=profil,
                       debut="2026-01-01", fin="2026-06-30")

    etat = rapport.acre
    assert etat["active"] is True
    assert etat["reduction_pourcent"] == 50
    assert etat["trimestres_restants"] == 3, "un trimestre consommé sur quatre"
    assert etat["date_fin_estimee"] == "2026-12-31"


def test_une_acre_expiree_est_signalee(mongo):
    """Le taux plein redevient dû : le taire ferait sous-estimer les cotisations."""
    profil = UserProfile(acre_active=True, acre_start_date="2024-01-15")
    rapport = _generer(ContexteFiscalRapport(acre_active=True), profil=profil)

    assert rapport.acre["expiree"] is True
    assert rapport.acre["trimestres_restants"] == 0
    alerte = next(a for a in rapport.alertes if "ACRE" in a.titre)
    assert alerte.niveau == "vigilance"


def test_sans_date_de_debut_l_acre_ne_prétend_pas_connaitre_sa_fin(mongo):
    rapport = _generer(ContexteFiscalRapport(acre_active=True))
    assert rapport.acre["trimestres_restants"] is None
    assert rapport.acre["date_fin_estimee"] is None
    assert "non renseignée" in rapport.acre["note"]


@pytest.mark.parametrize("debut,reference,restants", [
    ("2026-01-01", date(2026, 1, 1), 4),
    ("2026-01-01", date(2026, 4, 1), 3),
    ("2026-01-01", date(2026, 12, 31), 1),
    ("2026-01-01", date(2027, 1, 1), 0),
])
def test_le_decompte_des_trimestres_suit_les_trimestres_civils(debut, reference, restants):
    assert acre_flag.statut(True, debut, reference)["trimestres_restants"] == restants


# -- §8 Constantes appliquées ------------------------------------------------
def test_les_taux_utilises_sont_affiches_avec_leur_provenance(mongo):
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    parametres = _generer().parametres[0]
    for cle in ("taux_abattement", "taux_social", "taux_cfp",
                "taux_versement_liberatoire", "plafond_ca"):
        assert parametres[cle] is not None, f"{cle} manquant"
    assert parametres["provenance"]["seuils"]["fichier"] == "data/seuils.yaml"


def test_les_taux_affiches_sont_ceux_du_moteur(mongo):
    """Deux sources pour un même taux divergeraient : le rapport recopie, il ne redéfinit pas."""
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    rapport = _generer(ContexteFiscalRapport(categorie_par_defaut="BNC", caisse_bnc="CIPAV"))
    attendu = moteur.parametres_categorie("BNC", caisse_bnc="CIPAV")

    assert rapport.parametres[0]["taux_social"] == attendu["taux_social"]
    assert rapport.parametres[0]["caisse_bnc"] == "CIPAV"


def test_la_caisse_change_le_taux_social_affiche(mongo):
    general = moteur.parametres_categorie("BNC", caisse_bnc="REGIME_GENERAL")
    cipav = moteur.parametres_categorie("BNC", caisse_bnc="CIPAV")
    assert general["taux_social"] != cipav["taux_social"]


def test_les_taux_ne_sont_pas_ecrases_par_l_arrondi():
    """Un taux de 0,2 % arrondi à 2 décimales deviendrait 0,00."""
    assert moteur.parametres_categorie("BNC")["taux_cfp"] > 0


# -- §9 Prorata de première année --------------------------------------------
def test_le_prorata_annonce_sa_methode_et_ses_jours(mongo):
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    profil = UserProfile(activity_start_date="2026-10-01")
    rapport = _generer(ContexteFiscalRapport(jours_activite=92), profil=profil)

    assert rapport.prorata["applique"] is True
    assert rapport.prorata["jours_activite"] == 92
    assert rapport.prorata["date_creation"] == "2026-10-01"
    assert "365" in rapport.prorata["methode"]
    assert rapport.prorata["plafonds_proratises"]


def test_sans_prorata_l_etat_est_donne_quand_meme(mongo):
    prorata = _generer().prorata
    assert prorata["applique"] is False
    assert "plafond annuel plein" in prorata["note"]


def test_le_prorata_ne_touche_pas_aux_taux(mongo):
    """La spécification est explicite : le prorata porte sur le PLAFOND, pas sur les taux."""
    _facture("FA-2026-000001", 20000.0)
    _virement(mongo, "v1", 20000.0, "FA-2026-000001")

    plein = _generer().simulation
    partiel = _generer(ContexteFiscalRapport(jours_activite=90)).simulation

    assert plein["cotisations_sociales"] == partiel["cotisations_sociales"]
    assert plein["base_imposable"] == partiel["base_imposable"]


# -- §11 Ce qui ne doit PAS avoir changé -------------------------------------
def test_l_assiette_reste_l_encaisse(mongo):
    _facture("FA-2026-000001", 5000.0)  # émise, jamais payée
    rapport = _generer()

    assert rapport.ca_retenu == 0.0
    assert rapport.ca_facture_periode == 5000.0
    assert rapport.simulation["ca_total"] == 0.0, "le facturé n'alimente aucun calcul"


def test_les_depenses_restent_hors_du_calcul(mongo):
    _facture("FA-2026-000001", 30000.0)
    _virement(mongo, "v1", 30000.0, "FA-2026-000001")
    mongo["invoices"].insert_one({
        "user_id": UID, "document_id": "d1", "expense_category": "materiel",
        "invoice": {"issuer_name": "X", "issue_date": "2026-04-01",
                    "total_ttc": 9000.0, "amount_eur": 9000.0},
    })

    rapport = _generer()
    assert rapport.simulation["ca_total"] == 30000.0
    assert rapport.sources.total_depenses_eur == 9000.0
