"""Rapport fiscal — cas limites du fichier de formules, contre le moteur RÉEL.

Pas de moteur simulé ici : c'est précisément l'intégration orchestrateur → moteur d'impôt qui
doit être vérifiée. Ce que ces tests protègent :

  • CA = 0 : aucun impôt inventé, aucune division par zéro, un rapport quand même produit ;
  • activité mixte : vente et prestation ne partagent ni abattement ni taux de cotisations —
    les agréger serait faux ;
  • CIPAV : taux de cotisations distinct du régime général ;
  • franchissement du plafond micro : signalé, jamais conclu (il faut DEUX années) ;
  • franchissement TVA : drapeau seul, aucune TVA calculée ;
  • DOM : signalé comme non couvert, plutôt que chiffré aux taux métropolitains.
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from app.agents.impots import tools as moteur
from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal import tva as TVA
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport

ANNEE_DEBUT, ANNEE_FIN = "2026-01-01", "2026-12-31"


@pytest.fixture
def donnees(monkeypatch):
    """Injecte des factures et des virements sans base de données.

    `orchestrateur` importe ses dépendances par `from … import` : le nom est lié dans CE
    module, c'est donc lui qu'il faut patcher, pas la source.
    """
    etat: Dict[str, List[Dict[str, Any]]] = {"factures": [], "virements": []}
    monkeypatch.setattr(O, "_factures_avec_existence_fiscale", lambda uid: etat["factures"])
    monkeypatch.setattr(O, "_virements", lambda uid: etat["virements"])
    return etat


def _facture(numero, net, emission="2026-03-01", categorie="prestation"):
    """Franchise en base : total_ht == total_ttc == net_a_payer."""
    return {
        "id": f"id-{numero}", "numero": numero, "net_a_payer": net,
        "total_ht": net, "total_ttc": net,
        "date_emission": emission, "date_echeance": "2026-03-31",
        "client": {"nom": "Client SARL"},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie}],
    }


def _virement(doc_id, montant, motif, execution="2026-03-15"):
    return {
        "document_id": doc_id,
        "transfer": {"amount": montant, "currency": "EUR", "direction": "recu",
                     "execution_date": execution, "motif": motif, "sender_name": "Client SARL"},
    }


def _generer(contexte=None, debut=ANNEE_DEBUT, fin=ANNEE_FIN):
    return O.generer("u1", DemandeRapport(
        date_debut=debut, date_fin=fin,
        contexte=contexte or ContexteFiscalRapport(),
    ))


# -- CA = 0 ------------------------------------------------------------------
def test_ca_nul_donne_des_montants_nuls_pas_une_absence_de_calcul(donnees):
    """Zéro est un RÉSULTAT, pas un trou : le moteur tourne quand même.

    Auparavant le rapport se contentait de « aucun calcul n'a été effectué », ce qui laissait
    croire à une panne alors que tous les montants valent légitimement zéro.
    """
    rapport = _generer()

    assert rapport.ca_retenu == 0.0
    assert rapport.simulation is not None, "le calcul est fait, il aboutit à zéro"
    sim = rapport.simulation
    assert sim["base_imposable"] == 0.0
    assert sim["cotisations_sociales"] == 0.0
    assert sim["cfp"] == 0.0
    assert sim["taux_effectif"] is None, "pas de division par zéro"
    assert rapport.categories_fiscales, "la catégorie appliquée reste affichée"
    assert rapport.base_de_calcul, "l'assiette retenue reste expliquée même à zéro"


def test_ca_nul_l_explique_sans_laisser_croire_a_une_panne(donnees):
    rapport = _generer()
    explication = " ".join(rapport.hypotheses)
    assert "chiffre d'affaires nul" in explication
    assert "0 €" in explication


def test_ca_nul_ne_declenche_aucune_alerte_de_seuil(donnees):
    rapport = _generer()
    assert not [a for a in rapport.alertes if "seuil" in a.titre.lower()
                or "plafond" in a.titre.lower()]


# -- Activité mixte ----------------------------------------------------------
def test_activite_mixte_ventile_vente_et_prestation(donnees):
    """Vente et prestation n'ont ni le même abattement ni le même taux : jamais agrégées."""
    donnees["factures"] = [
        _facture("FA-2026-000001", 20000.0, categorie="vente"),
        _facture("FA-2026-000002", 10000.0, categorie="prestation"),
    ]
    donnees["virements"] = [
        _virement("v1", 20000.0, "FA-2026-000001"),
        _virement("v2", 10000.0, "FA-2026-000002"),
    ]
    rapport = _generer(ContexteFiscalRapport(categorie_par_defaut="BNC"))

    assert rapport.ca_retenu == 30000.0
    categories = {l["categorie"] for l in rapport.simulation["lignes"]}
    assert categories == {"BIC_VENTE", "BNC"}, "deux lignes distinctes, pas une somme"

    par_cat = {l["categorie"]: l for l in rapport.simulation["lignes"]}
    assert par_cat["BIC_VENTE"]["ca"] == 20000.0
    assert par_cat["BNC"]["ca"] == 10000.0
    # L'abattement vente (71 %) est plus large que celui du BNC (34 %) : les bases diffèrent
    # forcément. Si elles étaient égales, c'est qu'un seul taux aurait été appliqué aux deux.
    assert par_cat["BIC_VENTE"]["base_imposable"] < par_cat["BNC"]["base_imposable"]


def test_activite_mixte_le_ca_total_egale_la_somme_des_lignes(donnees):
    donnees["factures"] = [
        _facture("FA-2026-000001", 12000.0, categorie="vente"),
        _facture("FA-2026-000002", 8000.0, categorie="prestation"),
    ]
    donnees["virements"] = [
        _virement("v1", 12000.0, "FA-2026-000001"),
        _virement("v2", 8000.0, "FA-2026-000002"),
    ]
    rapport = _generer()
    assert round(sum(l["ca"] for l in rapport.simulation["lignes"]), 2) == rapport.ca_retenu


def test_une_seule_categorie_n_est_pas_traitee_comme_mixte(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 9000.0, categorie="prestation")]
    donnees["virements"] = [_virement("v1", 9000.0, "FA-2026-000001")]
    rapport = _generer()
    assert len(rapport.simulation["lignes"]) == 1


# -- CIPAV -------------------------------------------------------------------
def test_cipav_change_les_cotisations(donnees):
    """Le taux Cipav diffère du régime général : le contexte doit atteindre le moteur."""
    donnees["factures"] = [_facture("FA-2026-000001", 30000.0)]
    donnees["virements"] = [_virement("v1", 30000.0, "FA-2026-000001")]

    general = _generer(ContexteFiscalRapport(caisse_bnc="REGIME_GENERAL"))
    cipav = _generer(ContexteFiscalRapport(caisse_bnc="CIPAV"))

    assert general.simulation["cotisations_sociales"] != cipav.simulation["cotisations_sociales"]


def test_cipav_n_affecte_pas_la_base_imposable(donnees):
    """La caisse est une affaire sociale : l'abattement fiscal est le même."""
    donnees["factures"] = [_facture("FA-2026-000001", 30000.0)]
    donnees["virements"] = [_virement("v1", 30000.0, "FA-2026-000001")]

    general = _generer(ContexteFiscalRapport(caisse_bnc="REGIME_GENERAL"))
    cipav = _generer(ContexteFiscalRapport(caisse_bnc="CIPAV"))
    assert general.simulation["base_imposable"] == cipav.simulation["base_imposable"]


def test_les_cotisations_portent_sur_le_ca_plein_pas_sur_la_base_abattue(donnees):
    """L'erreur la plus fréquente sur ce calcul : appliquer le taux à la base abattue."""
    donnees["factures"] = [_facture("FA-2026-000001", 40000.0)]
    donnees["virements"] = [_virement("v1", 40000.0, "FA-2026-000001")]
    rapport = _generer()

    attendu = moteur.calculer_cotisations(
        [{"categorie": "BNC", "ca": 40000.0}], caisse_bnc="REGIME_GENERAL",
    )
    assert rapport.simulation["cotisations_sociales"] == attendu["cotisations_sociales"]
    assert attendu["assiette"] == 40000.0


# -- Franchissement du plafond micro -----------------------------------------
def test_depassement_de_plafond_signale_sans_conclure_a_la_sortie_du_regime(donnees):
    """La sortie suppose DEUX années consécutives : une période ne peut pas en décider."""
    donnees["factures"] = [_facture("FA-2026-000001", 90000.0)]
    donnees["virements"] = [_virement("v1", 90000.0, "FA-2026-000001")]
    rapport = _generer()

    alerte = next(a for a in rapport.alertes if "plafond" in a.titre.lower())
    assert alerte.niveau == "critique"
    assert "deux années consécutives" in alerte.message
    assert rapport.simulation is not None, "le calcul reste produit malgré le dépassement"


def test_ca_sous_le_plafond_ne_declenche_aucune_alerte_de_plafond(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 20000.0)]
    donnees["virements"] = [_virement("v1", 20000.0, "FA-2026-000001")]
    rapport = _generer()
    assert not [a for a in rapport.alertes if "plafond" in a.titre.lower()]


def test_le_plafond_est_proratise_la_premiere_annee(donnees):
    """Créée en cours d'année, l'entreprise voit son plafond réduit à due proportion."""
    donnees["factures"] = [_facture("FA-2026-000001", 45000.0)]
    donnees["virements"] = [_virement("v1", 45000.0, "FA-2026-000001")]

    annee_pleine = _generer(ContexteFiscalRapport())
    trois_mois = _generer(ContexteFiscalRapport(jours_activite=90))

    assert not [a for a in annee_pleine.alertes if "plafond" in a.titre.lower()]
    alerte = next(a for a in trois_mois.alertes if "plafond" in a.titre.lower())
    assert "proratisé" in alerte.message


# -- Franchise en base de TVA : drapeau seul ---------------------------------
def test_franchissement_tva_est_un_drapeau_et_ne_calcule_aucune_tva(donnees):
    seuil = TVA.seuils_tva()["services"]["seuil_base"]
    donnees["factures"] = [_facture("FA-2026-000001", seuil + 1000)]
    donnees["virements"] = [_virement("v1", seuil + 1000, "FA-2026-000001")]
    rapport = _generer()

    assert rapport.tva["depasse_base"] is True
    assert any("TVA" in a.titre for a in rapport.alertes)
    # Aucun montant de TVA nulle part : le rapport signale une position, il ne liquide pas.
    assert "montant_tva" not in rapport.tva and "tva_due" not in rapport.tva


def test_seuil_majore_de_tva_est_plus_grave_que_le_seuil_de_base(donnees):
    """Effets distincts : le seuil majoré rend redevable rétroactivement, pas le seuil de base."""
    bloc = TVA.seuils_tva()["services"]
    donnees["factures"] = [_facture("FA-2026-000001", bloc["seuil_majore"] + 500)]
    donnees["virements"] = [_virement("v1", bloc["seuil_majore"] + 500, "FA-2026-000001")]
    rapport = _generer()

    alerte = next(a for a in rapport.alertes if "TVA" in a.titre)
    assert alerte.niveau == "critique"
    assert "majoré" in alerte.titre
    assert "premier jour du mois" in alerte.message


def test_sous_le_seuil_de_tva_aucune_alerte(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 10000.0)]
    donnees["virements"] = [_virement("v1", 10000.0, "FA-2026-000001")]
    rapport = _generer()
    assert rapport.tva["depasse_base"] is False
    assert not [a for a in rapport.alertes if "TVA" in a.titre]


def test_seuils_tva_distincts_entre_vente_et_prestation(donnees):
    """Un CA de vente reste sous le seuil là où le même CA de prestation le franchit."""
    services = TVA.seuils_tva()["services"]["seuil_base"]
    statut = TVA.statut_franchise({"vente": services + 1000, "prestation": services + 1000})
    par_nature = {l["nature"]: l for l in statut["lignes"]}
    assert par_nature["prestation"]["depasse_base"] is True
    assert par_nature["vente"]["depasse_base"] is False


def test_sur_une_periode_partielle_le_franchissement_tva_reste_a_confirmer(donnees):
    seuil = TVA.seuils_tva()["services"]["seuil_base"]
    donnees["factures"] = [_facture("FA-2026-000001", seuil + 1000)]
    donnees["virements"] = [_virement("v1", seuil + 1000, "FA-2026-000001")]
    rapport = _generer(debut="2026-01-01", fin="2026-06-30")

    assert rapport.tva["periode_annee_complete"] is False
    alerte = next(a for a in rapport.alertes if "TVA" in a.titre)
    assert "année complète" in alerte.message


def test_les_seuils_tva_viennent_du_yaml_et_portent_leur_source(donnees):
    """Règle du projet : aucun seuil codé en dur, et chaque chiffre cite sa provenance."""
    statut = TVA.statut_franchise({"prestation": 1000.0})
    assert statut["source"] and statut["date_verif"]


# -- DOM ---------------------------------------------------------------------
def test_dom_est_signale_au_lieu_d_etre_chiffre_aux_taux_metropolitains(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 25000.0)]
    donnees["virements"] = [_virement("v1", 25000.0, "FA-2026-000001")]
    rapport = _generer(ContexteFiscalRapport(dom=True))

    alerte = next(a for a in rapport.alertes if "DOM" in a.titre)
    assert alerte.niveau == "critique"
    assert "SURESTIMENT" in alerte.message


def test_sans_dom_aucune_alerte_outre_mer(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 25000.0)]
    donnees["virements"] = [_virement("v1", 25000.0, "FA-2026-000001")]
    assert not [a for a in _generer().alertes if "DOM" in a.titre]


# -- IR : refus explicite plutôt que chiffre inventé -------------------------
def test_ir_non_calcule_sans_le_contexte_du_foyer(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 30000.0)]
    donnees["virements"] = [_virement("v1", 30000.0, "FA-2026-000001")]
    rapport = _generer()

    assert rapport.ir_calculable is False
    assert rapport.simulation["ir_bareme"] is None
    alerte = next(a for a in rapport.alertes if "revenu" in a.titre.lower())
    assert alerte.niveau == "info", "un refus documenté, pas une panne"


def test_ir_calcule_quand_le_foyer_est_renseigne(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 30000.0)]
    donnees["virements"] = [_virement("v1", 30000.0, "FA-2026-000001")]
    rapport = _generer(ContexteFiscalRapport(parts_fiscales=1.0, autres_revenus=0.0))

    assert rapport.ir_calculable is True
    assert rapport.simulation["ir_bareme"] is not None


def test_versement_liberatoire_indetermine_sans_rfr_n2(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 30000.0)]
    donnees["virements"] = [_virement("v1", 30000.0, "FA-2026-000001")]
    rapport = _generer(ContexteFiscalRapport(option_versement_liberatoire=True))
    assert rapport.simulation["versement_liberatoire"]["eligible"] is None
    assert any("libératoire" in a.titre for a in rapport.alertes)


# -- Un seul rapport : le facturé est un indicateur, jamais une assiette -----
def test_le_facture_est_un_indicateur_a_cote_de_l_assiette(donnees):
    """Un seul rapport. Le facturé s'affiche, mais seul l'encaissé est imposable."""
    donnees["factures"] = [_facture("FA-2026-000001", 5000.0)]
    donnees["virements"] = []  # émise, jamais payée

    rapport = _generer()

    assert rapport.ca_retenu == 0.0, "non encaissé : hors assiette"
    assert rapport.ca_facture_periode == 5000.0, "le facturé reste visible"
    assert rapport.simulation["cotisations_sociales"] == 0.0, "rien n'est dû sur le non-encaissé"


def test_l_ecart_entre_facture_et_encaisse_est_lisible(donnees):
    donnees["factures"] = [
        _facture("FA-2026-000001", 3000.0),
        _facture("FA-2026-000002", 2000.0),
    ]
    donnees["virements"] = [_virement("v1", 3000.0, "FA-2026-000001")]

    rapport = _generer()
    assert rapport.ca_retenu == 3000.0
    assert rapport.ca_facture_periode == 5000.0


def test_le_rapport_expose_toujours_le_detail_du_rapprochement(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 5000.0)]
    donnees["virements"] = [_virement("v1", 5000.0, "FA-2026-000001")]
    rapport = _generer()

    assert rapport.rapprochement is not None
    assert len(rapport.rapprochement.encaissements) == 1
    assert "ENCAISS" in rapport.base_de_calcul.upper()


# -- Traçabilité des chiffres ------------------------------------------------
def test_le_rapport_porte_la_provenance_des_taux(donnees):
    donnees["factures"] = [_facture("FA-2026-000001", 10000.0)]
    donnees["virements"] = [_virement("v1", 10000.0, "FA-2026-000001")]
    assert _generer().provenance, "un chiffre sans source n'est pas opposable"


def test_l_orchestrateur_recopie_le_moteur_sans_recalculer(donnees):
    """Deux implémentations du même calcul divergeraient : il ne doit y en avoir qu'une."""
    donnees["factures"] = [_facture("FA-2026-000001", 33000.0)]
    donnees["virements"] = [_virement("v1", 33000.0, "FA-2026-000001")]
    rapport = _generer(ContexteFiscalRapport(parts_fiscales=2.0, autres_revenus=15000.0))

    attendu = moteur.simuler_impots(
        activites=[{"categorie": "BNC", "ca": 33000.0}],
        parts_fiscales=2.0, autres_revenus=15000.0,
    )
    for champ in ("base_imposable", "cotisations_sociales", "cfp", "ir_bareme"):
        assert rapport.simulation[champ] == attendu[champ]
