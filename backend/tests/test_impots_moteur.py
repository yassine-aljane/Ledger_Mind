"""Moteur de calcul fiscal micro-entreprise — déterministe, sans LLM.

L'exemple chiffré de la spécification (§5) sert de référence : il fixe le
comportement attendu bout en bout, étape par étape.

Couvre ce que l'intégration doit préserver :
  • le barème, le quotient familial et la décote s'enchaînent dans l'ordre ;
  • l'assiette sociale est le CA PLEIN — l'abattement fiscal ne la réduit pas,
    c'est l'erreur la plus fréquente sur ce calcul ;
  • l'IR au barème n'est PAS calculé sans contexte de foyer, et le dit ;
  • aucune constante n'est codée en dur : tout vient de `data/`.
"""

from __future__ import annotations

import pytest

from app.agents.impots import constantes as C
from app.agents.impots import moteur
from app.agents.impots.constantes import CaisseBNC, CategorieFiscale
from app.agents.impots.schemas import ActiviteCA, ContexteFoyer, DemandeSimulation
from app.agents.impots.tools import (
    OUTILS,
    OUTILS_PAR_NOM,
    calculer_cotisations,
    constantes_fiscales,
    simuler_impots,
)

BNC = CategorieFiscale.bnc
VENTE = CategorieFiscale.bic_vente
SERVICE = CategorieFiscale.bic_service


# -- Étape 1 : abattement et base imposable ----------------------------------
def test_abattement_proportionnel():
    lignes = moteur.calculer_lignes([ActiviteCA(categorie=BNC, ca=42000)], mixte=False)
    assert lignes[0].abattement == pytest.approx(14280.0)      # 42 000 × 0,34
    assert lignes[0].base_imposable == pytest.approx(27720.0)
    assert lignes[0].plancher_applique is False


def test_le_plancher_prend_le_pas_sur_les_petits_ca():
    lignes = moteur.calculer_lignes([ActiviteCA(categorie=BNC, ca=500)], mixte=False)
    assert lignes[0].abattement == pytest.approx(305.0)        # 500 × 0,34 = 170 < 305
    assert lignes[0].plancher_applique is True


def test_le_plancher_ne_depasse_jamais_le_chiffre_d_affaires():
    """Sans cette borne, un CA de 100 € produirait une base imposable négative."""
    lignes = moteur.calculer_lignes([ActiviteCA(categorie=BNC, ca=100)], mixte=False)
    assert lignes[0].abattement == pytest.approx(100.0)
    assert lignes[0].base_imposable == pytest.approx(0.0)


def test_activite_mixte_par_categorie_et_plancher_double():
    activites = [ActiviteCA(categorie=VENTE, ca=300), ActiviteCA(categorie=BNC, ca=300)]
    lignes = moteur.calculer_lignes(activites, mixte=True)
    # 300 × 0,71 = 213 et 300 × 0,34 = 102 : tous deux sous le plancher mixte (610),
    # lui-même borné par le CA de chaque ligne.
    assert all(ligne.plancher_applique for ligne in lignes)
    assert all(ligne.abattement == pytest.approx(300.0) for ligne in lignes)


# -- Étape 2 : barème progressif ---------------------------------------------
def test_bareme_sous_le_seuil_d_imposition():
    assert moteur.impot_sur_quotient(11000) == pytest.approx(0.0)
    assert moteur.impot_sur_quotient(0) == pytest.approx(0.0)
    assert moteur.impot_sur_quotient(-500) == pytest.approx(0.0)


def test_bareme_deuxieme_tranche():
    # (27 720 − 11 600) × 0,11
    assert moteur.impot_sur_quotient(27720) == pytest.approx(1773.20)


def test_bareme_cumul_de_plusieurs_tranches():
    # (29 579 − 11 600) × 0,11 + (50 000 − 29 579) × 0,30
    attendu = 17979 * 0.11 + 20421 * 0.30
    assert moteur.impot_sur_quotient(50000) == pytest.approx(attendu)


def test_bareme_derniere_tranche_sans_borne():
    tranches = C.bareme_tranches()
    assert tranches[-1]["plafond"] is None
    assert moteur.impot_sur_quotient(300000) > moteur.impot_sur_quotient(200000)


# -- Étapes 3 à 5 : foyer, plafonnement, décote ------------------------------
def test_impot_du_foyer_celibataire():
    detail = moteur.impot_du_foyer(27720, parts=1, en_couple=False)
    assert detail.impot_avant_plafonnement == pytest.approx(1773.20)
    assert detail.plafonnement_applique is False
    # décote = 897 − 0,4525 × 1 773,20
    assert detail.decote == pytest.approx(94.627, abs=1e-3)
    assert detail.impot_net == pytest.approx(1678.573, abs=1e-3)


def test_la_decote_ne_cree_jamais_de_credit_d_impot():
    detail = moteur.impot_du_foyer(12000, parts=1, en_couple=False)
    assert detail.impot_net >= 0
    assert detail.decote <= detail.impot_apres_plafonnement


def test_le_plafonnement_borne_l_avantage_des_demi_parts():
    """Une part supplémentaire ne peut alléger l'impôt au-delà du plafond."""
    sans_enfant = moteur.impot_du_foyer(90000, parts=2, en_couple=True)
    avec_enfants = moteur.impot_du_foyer(90000, parts=3, en_couple=True)

    assert avec_enfants.plafonnement_applique is True
    # L'allègement obtenu ne dépasse pas le plafond des deux demi-parts.
    allegement = sans_enfant.impot_net - avec_enfants.impot_net
    assert allegement <= 2 * C.plafond_demi_part() + 1e-6


def test_sans_demi_part_supplementaire_aucun_plafonnement():
    detail = moteur.impot_du_foyer(50000, parts=1, en_couple=False)
    assert detail.plafonnement_applique is False
    assert detail.impot_apres_plafonnement == pytest.approx(detail.impot_avant_plafonnement)


# -- Étape 6 : méthode différentielle ----------------------------------------
def test_l_ir_impute_est_la_difference_avec_et_sans_micro():
    foyer = ContexteFoyer(parts=1, autres_revenus=20000, en_couple=False)
    impute, avec, sans = moteur.ir_impute_micro(27720, foyer)

    assert impute == pytest.approx(avec.impot_net - sans.impot_net)
    assert avec.revenu_net_imposable == pytest.approx(47720)
    assert sans.revenu_net_imposable == pytest.approx(20000)


def test_l_ir_n_est_pas_calcule_sans_contexte_de_foyer():
    """Le barème est progressif : sans les autres revenus, aucun montant n'est honnête."""
    impute, avec, sans = moteur.ir_impute_micro(27720, ContexteFoyer())
    assert (impute, avec, sans) == (None, None, None)

    impute, _, _ = moteur.ir_impute_micro(27720, ContexteFoyer(parts=1))
    assert impute is None, "les parts seules ne suffisent pas"


# -- Étapes 8 et 9 : assiette sociale ----------------------------------------
def test_les_cotisations_portent_sur_le_ca_plein():
    """L'abattement fiscal ne réduit pas l'assiette sociale."""
    activites = [ActiviteCA(categorie=BNC, ca=42000)]
    cotisations = moteur.cotisations_sociales(activites, CaisseBNC.regime_general, acre_active=False)
    assert cotisations == pytest.approx(42000 * C.taux_social(BNC))
    assert cotisations == pytest.approx(10752.0)   # 42 000 × 0,256


def test_acre_reduit_de_moitie():
    activites = [ActiviteCA(categorie=BNC, ca=42000)]
    plein = moteur.cotisations_sociales(activites, CaisseBNC.regime_general, acre_active=False)
    avec_acre = moteur.cotisations_sociales(activites, CaisseBNC.regime_general, acre_active=True)
    assert avec_acre == pytest.approx(plein * 0.5)
    assert avec_acre == pytest.approx(5376.0)


def test_la_caisse_bnc_change_le_taux():
    activites = [ActiviteCA(categorie=BNC, ca=10000)]
    general = moteur.cotisations_sociales(activites, CaisseBNC.regime_general, False)
    cipav = moteur.cotisations_sociales(activites, CaisseBNC.cipav, False)
    assert general != cipav


def test_cfp_assise_sur_le_ca():
    activites = [ActiviteCA(categorie=BNC, ca=42000)]
    assert moteur.contribution_formation(activites, CaisseBNC.regime_general) == pytest.approx(84.0)


# -- Étape 7 : versement libératoire -----------------------------------------
def test_eligibilite_selon_le_rfr_et_les_parts():
    plafond_par_part = C.rfr_maximum_par_part()
    sous = moteur.eligibilite_versement_liberatoire(
        ContexteFoyer(parts=1, rfr_n2=plafond_par_part - 1)
    )
    au_dessus = moteur.eligibilite_versement_liberatoire(
        ContexteFoyer(parts=1, rfr_n2=plafond_par_part + 1)
    )
    assert sous.eligible is True
    assert au_dessus.eligible is False
    assert "supérieur au plafond" in au_dessus.motif_ineligibilite


def test_eligibilite_indeterminable_sans_rfr():
    resultat = moteur.eligibilite_versement_liberatoire(ContexteFoyer(parts=1))
    assert resultat.eligible is None, "indéterminable n'est pas inéligible"


def test_le_versement_liberatoire_porte_sur_le_ca_brut():
    montant = moteur.montant_versement_liberatoire([ActiviteCA(categorie=BNC, ca=42000)])
    assert montant == pytest.approx(924.0)   # 42 000 × 0,022, sans abattement


# -- §3 : prorata de première année ------------------------------------------
def test_le_plafond_est_proratise_la_premiere_annee():
    plein, proratise = moteur.plafond_applicable(BNC, jours_activite=None)
    demi, est_proratise = moteur.plafond_applicable(BNC, jours_activite=182)
    assert proratise is False
    assert est_proratise is True
    assert demi == pytest.approx(plein * 182 / 365)


def test_depassement_signale_sans_conclure_a_la_sortie_du_regime():
    plafond = C.plafond_ca(BNC)
    depassements = moteur.controler_plafonds(
        [ActiviteCA(categorie=BNC, ca=plafond + 1000)], jours_activite=None
    )
    assert len(depassements) == 1
    assert depassements[0].plafond_proratise is False


# -- §5 : l'exemple chiffré de la spécification, bout en bout -----------------
def test_exemple_de_reference_de_la_specification():
    """BNC, célibataire (P=1), autres revenus nuls, ACRE actif, CA = 42 000 €."""
    resultat = moteur.simuler(
        DemandeSimulation(
            activites=[ActiviteCA(categorie=BNC, ca=42000)],
            foyer=ContexteFoyer(parts=1, autres_revenus=0, en_couple=False, rfr_n2=0),
            acre_active=True,
            option_versement_liberatoire=False,
        )
    )

    assert resultat.base_imposable == pytest.approx(27720.0)
    assert resultat.ir_bareme == pytest.approx(1678.57, abs=0.01)
    assert resultat.cotisations_sociales == pytest.approx(5376.0)
    assert resultat.cfp == pytest.approx(84.0)
    assert resultat.versement_liberatoire.montant == pytest.approx(924.0)

    # Option barème retenue (l'utilisateur n'a pas opté) …
    assert resultat.option_retenue == "bareme"
    assert resultat.total_prelevements == pytest.approx(7138.57, abs=0.01)
    assert resultat.revenu_net_estime == pytest.approx(34861.43, abs=0.01)
    assert resultat.taux_effectif == pytest.approx(0.170, abs=0.001)
    # … mais le versement libératoire est moins cher : la recommandation le dit.
    assert resultat.recommandation == "versement_liberatoire"


def test_exemple_de_reference_avec_option_versement_liberatoire():
    resultat = moteur.simuler(
        DemandeSimulation(
            activites=[ActiviteCA(categorie=BNC, ca=42000)],
            foyer=ContexteFoyer(parts=1, autres_revenus=0, rfr_n2=0),
            acre_active=True,
            option_versement_liberatoire=True,
        )
    )
    assert resultat.ir_retenu == pytest.approx(924.0)
    assert resultat.total_prelevements == pytest.approx(6384.0)
    assert resultat.revenu_net_estime == pytest.approx(35616.0)
    assert resultat.taux_effectif == pytest.approx(0.152, abs=0.001)


# -- Cas limites -------------------------------------------------------------
def test_ca_nul():
    resultat = moteur.simuler(
        DemandeSimulation(
            activites=[ActiviteCA(categorie=BNC, ca=0)],
            foyer=ContexteFoyer(parts=1, autres_revenus=0),
        )
    )
    assert resultat.cotisations_sociales == 0
    assert resultat.cfp == 0
    assert resultat.ir_bareme == 0
    assert resultat.taux_effectif is None, "aucun taux effectif sur un CA nul"


def test_simulation_sans_contexte_de_foyer_reste_exploitable():
    """Base imposable et cotisations restent calculées ; l'IR est déclaré indisponible."""
    resultat = moteur.simuler(
        DemandeSimulation(activites=[ActiviteCA(categorie=BNC, ca=42000)])
    )
    assert resultat.base_imposable == pytest.approx(27720.0)
    assert resultat.cotisations_sociales > 0
    assert resultat.ir_bareme is None
    assert resultat.ir_bareme_calculable is False
    assert any("non calculable" in a for a in resultat.avertissements)


def test_les_approximations_sont_signalees():
    resultat = moteur.simuler(
        DemandeSimulation(
            activites=[ActiviteCA(categorie=BNC, ca=10000)],
            foyer=ContexteFoyer(parts=2, autres_revenus=0, en_couple=True),
            acre_active=True,
        )
    )
    assert any("ACRE" in a for a in resultat.avertissements)
    assert any("Décote" in a for a in resultat.avertissements)


def test_la_provenance_accompagne_chaque_calcul():
    resultat = moteur.simuler(
        DemandeSimulation(activites=[ActiviteCA(categorie=BNC, ca=1000)])
    )
    assert resultat.provenance["seuils"]["date_verif"]
    assert resultat.provenance["impot_revenu"]["fichier"] == "data/impot_revenu.yaml"


# -- Couche outils -----------------------------------------------------------
def test_les_outils_rendent_du_json_serialisable():
    sortie = simuler_impots(
        activites=[{"categorie": "BNC", "ca": 42000}],
        parts_fiscales=1,
        autres_revenus=0,
        rfr_n2=0,
        acre_active=True,
    )
    import json

    json.dumps(sortie)   # ne doit pas lever
    assert sortie["base_imposable"] == 27720.0
    assert sortie["cotisations_sociales"] == 5376.0


def test_les_montants_sont_arrondis_a_l_affichage():
    sortie = simuler_impots(
        activites=[{"categorie": "BNC", "ca": 42000}],
        parts_fiscales=1,
        autres_revenus=0,
    )
    assert sortie["ir_bareme"] == 1678.57, "arrondi au centime en sortie"


def test_outil_cotisations_signale_l_approximation_acre():
    sortie = calculer_cotisations([{"categorie": "BNC", "ca": 10000}], acre_active=True)
    assert "avertissement" in sortie
    sans = calculer_cotisations([{"categorie": "BNC", "ca": 10000}], acre_active=False)
    assert "avertissement" not in sans


def test_les_constantes_exposees_portent_leur_provenance():
    sortie = constantes_fiscales()
    assert sortie["abattements"]["BNC"] == 0.34
    assert sortie["provenance"]["seuils"]["fichier"] == "data/seuils.yaml"


def test_le_registre_decrit_chaque_outil():
    assert len(OUTILS) == 6
    for outil in OUTILS:
        assert outil.description, f"{outil.nom} doit porter une description"
        assert callable(outil.fonction)
        # Forme attendue par un adaptateur de framework d'agent.
        params = outil.pour_langchain()
        assert params["name"] == outil.nom and callable(params["func"])
    assert set(OUTILS_PAR_NOM) == {o.nom for o in OUTILS}


# -- Aucune constante en dur -------------------------------------------------
def test_les_constantes_viennent_bien_des_fichiers_de_donnees():
    """Un changement de YAML doit se répercuter sans toucher au code."""
    original = C.abattement_taux(BNC)
    try:
        C.reload()
        assert C.abattement_taux(BNC) == original
        # Les valeurs proviennent du fichier projet, pas d'une copie locale.
        from app.agents.guidance.roadmap import seuils as seuils_projet

        assert C.abattement_taux(BNC) == seuils_projet.bloc("micro")["bnc"]["abattement"]
    finally:
        C.reload()
