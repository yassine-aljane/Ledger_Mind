"""Rapport fiscal : rapprochement bancaire et orchestration du moteur d'impôt.

Règle métier non négociable vérifiée ici : le CA imposable est l'ENCAISSÉ. Une facture émise
et non payée ne compte pas pour la période — elle comptera pour celle où le virement arrive.

Couvre ce que l'intégration doit préserver :
  • un virement SORTANT n'entre jamais dans le chiffre d'affaires — l'y inclure gonflerait
    l'impôt et les cotisations ;
  • le rattachement par n° de facture est certain, celui par montant+date demande confirmation
    et n'est jamais appliqué en silence quand plusieurs factures conviennent ;
  • chaque euro retenu est traçable jusqu'à un virement précis (auditabilité) ;
  • l'agent n'écrit AUCUNE formule fiscale : il appelle le moteur et recopie sa réponse.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.agents.rapport_fiscal import rapprochement as R


def _facture(numero, net, emission="2026-03-01", echeance="2026-03-31",
             categorie="prestation", client="Client SARL", fid=None, ht=None):
    """Facture en franchise de TVA par défaut : `ht` permet de simuler une facture taxée."""
    return {
        "id": fid or f"id-{numero}",
        "numero": numero,
        "net_a_payer": net,
        "total_ttc": net,
        "total_ht": net if ht is None else ht,
        "date_emission": emission,
        "date_echeance": echeance,
        "client": {"nom": client},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie}],
    }


def _virement(doc_id, montant, execution="2026-03-15", direction="recu",
              motif=None, reference=None, sender="Client SARL"):
    return {
        "document_id": doc_id,
        "transfer": {
            "amount": montant, "currency": "EUR", "direction": direction,
            "execution_date": execution, "motif": motif,
            "transfer_reference": reference, "sender_name": sender,
        },
    }


DEBUT, FIN = date(2026, 3, 1), date(2026, 3, 31)


# -- Extraction du numéro de facture -----------------------------------------
@pytest.mark.parametrize("texte,attendu", [
    ("Paiement FA-2026-000042", ["FA-2026-000042"]),
    ("réf FA 2026 000042 merci", ["FA-2026-000042"]),
    ("fa-2026-000042", ["FA-2026-000042"]),
    ("Solde AV-2026-000007", ["AV-2026-000007"]),
    ("FA-2026-000001 et FA-2026-000002", ["FA-2026-000001", "FA-2026-000002"]),
    ("virement sans reference", []),
    (None, []),
])
def test_reperage_des_numeros_dans_le_libelle(texte, attendu):
    assert R.numeros_factures_cites(texte) == attendu


# -- Le sens de l'opération --------------------------------------------------
def test_un_virement_sortant_n_entre_jamais_dans_le_ca():
    """L'inclure gonflerait le CA imposable, donc l'impôt et les cotisations."""
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1000.0)],
        [_virement("v1", 1000.0, direction="emis", motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 0.0
    assert len(r.virements_non_retenus) == 1
    assert "sortant" in r.virements_non_retenus[0].motif


def test_un_sens_indetermine_est_soumis_a_confirmation():
    r = R.rapprocher([], [_virement("v1", 500.0, direction=None)], DEBUT, FIN)
    assert r.ca_encaisse == 0.0
    non_retenu = r.virements_non_retenus[0]
    assert "indéterminé" in non_retenu.motif
    assert non_retenu.action_suggeree, "l'utilisateur doit savoir quoi faire"


# -- Rattachement par numéro (certain) ---------------------------------------
def test_rattachement_par_numero_de_facture():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1000.0)],
        [_virement("v1", 1000.0, motif="Virement FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 1000.0
    assert r.ca_encaisse_certain == 1000.0
    ligne = r.encaissements[0]
    assert ligne.methode == "numero_facture" and ligne.certain is True
    assert ligne.virement_document_id == "v1", "traçabilité jusqu'au virement"
    assert r.factures_impayees == []


def test_le_numero_dans_la_reference_marche_aussi():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 300.0)],
        [_virement("v1", 300.0, motif="paiement", reference="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 300.0


# -- Rattachement par montant et date (à confirmer) --------------------------
def test_rattachement_par_montant_demande_confirmation():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 750.0)],
        [_virement("v1", 750.0, motif="virement client")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 750.0
    assert r.ca_encaisse_certain == 0.0, "rien de certain sans référence"
    assert r.encaissements[0].methode == "montant_date"
    assert r.encaissements[0].certain is False


def test_deux_factures_du_meme_montant_ne_sont_pas_tranchees():
    """Indiscernables sans référence : deviner rattacherait le mauvais encaissement."""
    r = R.rapprocher(
        [_facture("FA-2026-000001", 500.0), _facture("FA-2026-000002", 500.0)],
        [_virement("v1", 500.0, motif="virement")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 0.0
    assert "impossible de trancher" in r.virements_non_retenus[0].motif


def test_encaissement_hors_fenetre_de_dates_non_rattache():
    """Une coïncidence de montant très éloignée dans le temps ne prouve rien."""
    r = R.rapprocher(
        [_facture("FA-2026-000001", 400.0, emission="2025-01-01", echeance="2025-02-01")],
        [_virement("v1", 400.0, execution="2026-03-15")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 0.0


# -- Cas limites du rapprochement --------------------------------------------
def test_virement_groupe_solde_plusieurs_factures():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 600.0), _facture("FA-2026-000002", 400.0)],
        [_virement("v1", 1000.0, motif="FA-2026-000001 + FA-2026-000002")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 1000.0
    assert {e.facture_numero for e in r.encaissements} == {"FA-2026-000001", "FA-2026-000002"}
    assert r.factures_impayees == []


def test_paiement_partiel():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1000.0)],
        [_virement("v1", 400.0, motif="acompte FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 400.0, "seul l'encaissé compte"
    assert r.factures_partielles[0].reste_du == 600.0
    assert r.factures_impayees == []


def test_excedent_signale_sans_etre_absorbe():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 500.0)],
        [_virement("v1", 800.0, motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert any(e.type == "excedent" for e in r.ecarts)


def test_virement_sans_facture_correspondante():
    r = R.rapprocher([], [_virement("v1", 900.0, motif="don")], DEBUT, FIN)
    assert r.ca_encaisse == 0.0
    assert "sans facture" in r.virements_non_retenus[0].motif


def test_facture_impayee_ne_compte_pas():
    """LA règle : émise mais non encaissée, elle est hors CA de la période."""
    r = R.rapprocher([_facture("FA-2026-000001", 1200.0)], [], DEBUT, FIN)
    assert r.ca_encaisse == 0.0
    assert r.factures_impayees[0].reste_du == 1200.0


def test_retard_de_paiement_calcule():
    hier = (date.today() - timedelta(days=10)).isoformat()
    r = R.rapprocher(
        [_facture("FA-2026-000001", 500.0, emission="2026-01-01", echeance=hier)], [],
        date(2026, 1, 1), date(2026, 12, 31),
    )
    impayee = r.factures_impayees[0]
    assert impayee.en_retard is True
    assert impayee.jours_de_retard == 10


def test_un_virement_hors_periode_n_est_pas_compte_mais_est_recense():
    """Ne pas le compter est correct ; le taire ne l'est pas.

    Un utilisateur devant « CA : 0 € » n'a aucun moyen de deviner que son virement se trouve
    hors bornes — c'est exactement le piège qui a fait croire à une panne du rapprochement.
    """
    r = R.rapprocher(
        [_facture("FA-2026-000001", 500.0)],
        [_virement("v1", 500.0, execution="2026-06-15", motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 0.0, "il relève d'une autre période"
    assert r.virements_non_retenus == [], "ce n'est pas une anomalie de rapprochement"

    hors = r.virements_hors_periode
    assert len(hors) == 1
    assert hors[0]["date"] == "2026-06-15"
    assert hors[0]["montant"] == 500.0
    assert hors[0]["cite_une_facture"] is True, "il cite pourtant une facture connue"


# -- La date qui rattache à une période --------------------------------------
def test_c_est_la_date_d_operation_qui_rattache_pas_la_date_de_valeur():
    """La date de valeur est une convention bancaire, souvent décalée d'un ou deux jours.

    La privilégier faisait sortir de la période un virement exécuté le dernier jour — et il
    disparaissait sans un mot, laissant un CA nul inexplicable.
    """
    virement = _virement("v1", 500.0, execution="2026-03-31", motif="FA-2026-000001")
    virement["transfer"]["value_date"] = "2026-04-02"  # J+2, hors période

    r = R.rapprocher([_facture("FA-2026-000001", 500.0)], [virement], DEBUT, FIN)

    assert r.ca_encaisse == 500.0, "exécuté dans la période : il compte"
    assert r.encaissements[0].date_valeur == "2026-03-31"


def test_la_date_de_valeur_sert_de_repli_si_l_execution_manque():
    virement = _virement("v1", 500.0, motif="FA-2026-000001")
    virement["transfer"]["execution_date"] = None
    virement["transfer"]["value_date"] = "2026-03-20"

    r = R.rapprocher([_facture("FA-2026-000001", 500.0)], [virement], DEBUT, FIN)
    assert r.ca_encaisse == 500.0


def test_sans_aucune_date_le_virement_ne_peut_pas_etre_rattache():
    virement = _virement("v1", 500.0, motif="FA-2026-000001")
    virement["transfer"]["execution_date"] = None
    virement["transfer"]["value_date"] = None

    r = R.rapprocher([_facture("FA-2026-000001", 500.0)], [virement], DEBUT, FIN)
    assert r.ca_encaisse == 0.0
    assert len(r.virements_hors_periode) == 1, "recensé plutôt que disparu"


def test_montant_negatif_ecarte():
    r = R.rapprocher([], [_virement("v1", -100.0)], DEBUT, FIN)
    assert r.ca_encaisse == 0.0
    assert "négatif" in r.virements_non_retenus[0].motif


def test_un_encaissement_solde_une_facture_de_la_periode_precedente():
    """Le décalage encaissement/facturation est la raison d'être du rapprochement."""
    r = R.rapprocher(
        [_facture("FA-2026-000001", 800.0, emission="2026-01-10", echeance="2026-02-10")],
        [_virement("v1", 800.0, execution="2026-03-05", motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 800.0


# -- Ventilation par catégorie (activité mixte) ------------------------------
def test_ventilation_prestation_vente():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 600.0, categorie="prestation"),
         _facture("FA-2026-000002", 400.0, categorie="vente")],
        [_virement("v1", 600.0, motif="FA-2026-000001"),
         _virement("v2", 400.0, motif="FA-2026-000002")],
        DEBUT, FIN,
    )
    assert r.ca_par_categorie == {"prestation": 600.0, "vente": 400.0}


# -- La TVA collectée n'est pas du chiffre d'affaires ------------------------
def test_le_ca_retient_le_ht_pas_le_ttc_encaisse():
    """Le client paie TTC, mais la TVA transite : l'assiette micro est le HT.

    En franchise en base les deux coïncident, ce qui masque complètement l'erreur — d'où ce
    test sur une facture assujettie.
    """
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1200.0, ht=1000.0)],
        [_virement("v1", 1200.0, motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 1000.0, "la TVA collectée n'est pas un revenu"
    ligne = r.encaissements[0]
    assert ligne.montant == 1200.0, "le relevé bancaire montre bien 1200 €"
    assert ligne.montant_ht == 1000.0
    assert r.factures_impayees == [], "la facture est pourtant intégralement soldée"


def test_un_paiement_partiel_est_converti_au_prorata():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1200.0, ht=1000.0)],
        [_virement("v1", 600.0, motif="acompte FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 500.0
    assert r.factures_partielles[0].reste_du == 600.0, "le reste dû se suit en TTC"


def test_en_franchise_de_tva_le_ht_egale_l_encaisse():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 900.0)],
        [_virement("v1", 900.0, motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_encaisse == 900.0 and r.encaissements[0].montant_ht == 900.0


def test_la_ventilation_par_categorie_est_aussi_en_ht():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 1200.0, ht=1000.0, categorie="vente")],
        [_virement("v1", 1200.0, motif="FA-2026-000001")],
        DEBUT, FIN,
    )
    assert r.ca_par_categorie == {"vente": 1000.0}


# -- Auditabilité ------------------------------------------------------------
def test_chaque_euro_retenu_est_tracable():
    r = R.rapprocher(
        [_facture("FA-2026-000001", 600.0), _facture("FA-2026-000002", 400.0)],
        [_virement("v1", 600.0, motif="FA-2026-000001"),
         _virement("v2", 400.0, motif="FA-2026-000002")],
        DEBUT, FIN,
    )
    assert round(sum(e.montant for e in r.encaissements), 2) == r.ca_encaisse
    assert all(e.virement_document_id for e in r.encaissements)


def test_les_avoirs_ne_reclament_aucun_encaissement():
    r = R.rapprocher([_facture("AV-2026-000001", -500.0)], [], DEBUT, FIN)
    assert r.factures_impayees == [] and r.factures_partielles == []
