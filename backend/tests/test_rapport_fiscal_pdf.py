"""Export PDF du rapport fiscal — il doit se rendre sans exception, sur tous les cas.

Un PDF qui plante à la génération est un rapport perdu. On vérifie donc surtout les cas
dégradés — CA nul, IR non calculable, listes vides, textes accentués longs — plutôt que le
cas nominal, seul cas qui ne casse jamais.

Le contenu textuel n'est pas relu ici (fpdf2 ne le rend pas relisible simplement) ; ce que ces
tests protègent, c'est l'absence de plantage et le fait qu'un champ nul ne devienne pas un zéro.
"""

from __future__ import annotations

import pytest

from app.agents.rapport_fiscal.pdf import _fr_date, _texte_provenance, rapport_to_pdf
from app.agents.rapport_fiscal.schemas import (
    Alerte,
    FactureNonSoldee,
    LigneEncaissement,
    Rapprochement,
    RapportFiscal,
    VirementNonRetenu,
)


def _rapport(**surcharges) -> RapportFiscal:
    base = dict(
        id="r1", uid="u1",
        date_debut="2026-01-01", date_fin="2026-12-31",
        genere_le="2026-08-03T10:00:00+00:00",
        ca_retenu=0.0, base_de_calcul="CA ENCAISSÉ.",
        provenance={"seuils": {"fichier": "data/seuils.yaml", "annee": 2026,
                               "date_verif": "2026-07-23"}},
    )
    base.update(surcharges)
    return RapportFiscal(**base)


def _rapprochement_complet() -> Rapprochement:
    return Rapprochement(
        periode_debut="2026-01-01", periode_fin="2026-12-31",
        ca_encaisse=1500.0, ca_encaisse_certain=1000.0,
        encaissements=[
            LigneEncaissement(
                virement_document_id="v1", montant=1200.0, montant_ht=1000.0, date_valeur="2026-03-15",
                libelle="Virement FA-2026-000001", contrepartie="Client SARL",
                facture_numero="FA-2026-000001", facture_id="f1",
                methode="numero_facture", certain=True, categorie="prestation",
            ),
            LigneEncaissement(
                virement_document_id="v2", montant=500.0, montant_ht=500.0, date_valeur="2026-04-02",
                libelle="VIR SEPA", facture_numero="FA-2026-000002", facture_id="f2",
                methode="montant_date", certain=False, categorie="vente",
            ),
        ],
        virements_non_retenus=[VirementNonRetenu(
            virement_document_id="v3", montant=250.0, date_valeur="2026-05-01",
            libelle="Prélèvement URSSAF", motif="Sens de l'opération lu comme « émis ».",
            action_suggeree="Confirmez s'il s'agit d'un encaissement.",
        )],
        factures_impayees=[FactureNonSoldee(
            numero="FA-2026-000003", facture_id="f3", client="Société Générale Études & Conseil",
            date_emission="2026-02-01", date_echeance="2026-03-01",
            net_a_payer=2400.0, encaisse=0.0, reste_du=2400.0,
            en_retard=True, jours_de_retard=45,
        )],
        factures_partielles=[FactureNonSoldee(
            numero="FA-2026-000004", facture_id="f4", client="Client B",
            date_emission="2026-06-01", date_echeance="2026-07-01",
            net_a_payer=800.0, encaisse=300.0, reste_du=500.0,
        )],
        ca_par_categorie={"prestation": 1000.0, "vente": 500.0},
    )


def test_rapport_vide_se_rend_sans_planter():
    """Le cas le plus fragile : aucune simulation, aucun rapprochement, aucune ligne."""
    pdf = rapport_to_pdf(_rapport())
    assert pdf[:4] == b"%PDF"


def test_rapport_complet_se_rend():
    rapport = _rapport(
        ca_retenu=1500.0,
        rapprochement=_rapprochement_complet(),
        simulation={
            "ca_total": 1500.0,
            "lignes": [
                {"categorie": "BNC", "ca": 1000.0, "taux_abattement": 0.34,
                 "abattement": 340.0, "base_imposable": 660.0, "plancher_applique": True},
                {"categorie": "BIC_VENTE", "ca": 500.0, "taux_abattement": 0.71,
                 "abattement": 355.0, "base_imposable": 145.0, "plancher_applique": False},
            ],
            "base_imposable": 805.0, "ir_bareme": 0.0, "ir_bareme_calculable": True,
            "cotisations_sociales": 273.5, "cfp": 3.5,
            "versement_liberatoire": {"eligible": True, "montant": 30.5},
            "option_retenue": "bareme", "recommandation": "Le barème reste plus favorable.",
            "total_prelevements": 277.0, "revenu_net_estime": 1223.0, "taux_effectif": 0.1847,
            "depassements": [],
        },
        ir_calculable=True,
        tva={
            "lignes": [{"nature": "prestation", "libelle": "prestations de services",
                        "ca": 1000.0, "seuil_base": 37500, "seuil_majore": 41250,
                        "depasse_base": False, "depasse_majore": False,
                        "reste_avant_base": 36500.0}],
            "depasse_base": False, "depasse_majore": False, "note": "Drapeau indicatif.",
        },
        alertes=[
            Alerte(niveau="critique", titre="Plafond dépassé", message="CA supérieur au plafond."),
            Alerte(niveau="vigilance", titre="Rattachements à confirmer", message="500 € à valider."),
            Alerte(niveau="info", titre="ACRE appliquée", message="Estimation favorable."),
        ],
        hypotheses=["CA encaissé.", "Barème 2026."],
    )
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_ir_non_calculable_ne_devient_pas_zero():
    """`None` veut dire « non calculé » ; l'afficher « 0 » se lirait comme « rien à payer »."""
    rapport = _rapport(
        ca_retenu=30000.0, ir_calculable=False,
        simulation={
            "base_imposable": 19800.0, "ir_bareme": None, "ir_bareme_calculable": False,
            "cotisations_sociales": 7680.0, "cfp": 60.0,
            "versement_liberatoire": {"eligible": None, "montant": None,
                                      "motif_ineligibilite": "RFR N-2 non fourni."},
            "total_prelevements": None, "revenu_net_estime": None, "taux_effectif": None,
            "lignes": [{"categorie": "BNC", "ca": 30000.0, "taux_abattement": 0.34,
                        "abattement": 10200.0, "base_imposable": 19800.0}],
        },
    )
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_un_rapport_sans_rapprochement_se_rend():
    """Cas dégradé : le rapprochement a échoué, le reste du rapport doit sortir quand même."""
    rapport = _rapport(ca_retenu=5000.0, rapprochement=None, ca_facture_periode=5000.0)
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_les_nouvelles_sections_se_rendent():
    """Plafond, prorata, ACRE et paramètres : quatre sections, quatre sauts de page possibles."""
    rapport = _rapport(
        ca_retenu=30000.0,
        categories_fiscales=["BNC"],
        plafonds={
            "plafonds": [{"categorie": "BNC", "ca": 30000.0, "plafond": 21071.78,
                          "plafond_proratise": True, "conforme": False, "marge_restante": 0.0}],
            "au_dessus_du_plafond": True, "jours_activite": 92,
            "note": "La sortie du régime suppose deux années consécutives.",
        },
        prorata={
            "applique": True, "jours_activite": 92, "date_creation": "2026-10-01",
            "methode": "plafond × (jours d'activité / 365)",
            "plafonds_proratises": [{"categorie": "BNC", "plafond": 21071.78}],
            "note": "Le prorata ne porte QUE sur le plafond.",
        },
        acre={
            "active": True, "reduction": 0.5, "reduction_pourcent": 50,
            "duree_trimestres": 4, "date_debut": "2026-10-01", "trimestres_restants": 4,
            "date_fin_estimee": "2027-09-30", "hypothese": "4 premiers trimestres civils.",
        },
        parametres=[{
            "categorie": "BNC", "caisse_bnc": "REGIME_GENERAL", "taux_abattement": 0.34,
            "abattement_minimum": 305.0, "taux_social": 0.256, "taux_cfp": 0.002,
            "taux_versement_liberatoire": 0.022, "plafond_ca": 21071.78,
            "plafond_proratise": True, "acre": {}, "provenance": {},
        }],
        simulation={
            "ca_total": 30000.0, "base_imposable": 19800.0, "ir_bareme": 413.0,
            "ir_bareme_calculable": True, "cotisations_sociales": 7680.0, "cfp": 60.0,
            "versement_liberatoire": {"eligible": True, "montant": 660.0},
            "option_retenue": "bareme", "recommandation": "Le barème est plus favorable.",
            "total_prelevements": 8153.0, "revenu_net_estime": 21847.0,
            "taux_effectif": 0.2718, "lignes": [],
        },
    )
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_le_ca_nul_n_affiche_pas_un_taux_effectif_de_zero():
    """Un 0 % se lirait « rien à payer » ; sans CA le rapport n'est simplement pas applicable."""
    from app.agents.rapport_fiscal.pdf import _pct

    assert _pct(None) == "—"
    assert _pct(0.002) == "0,20 %", "un taux de 0,2 % ne doit pas devenir 0 %"
    assert _pct(0.256) == "25,6 %"
    assert _pct(0.34) == "34 %"


def test_beaucoup_de_lignes_paginent_sans_planter():
    """Le saut de page manuel est la source d'erreur classique de fpdf2."""
    rappro = _rapprochement_complet()
    rappro.encaissements = [
        LigneEncaissement(
            virement_document_id=f"v{i}", montant=100.0 + i, montant_ht=100.0 + i,
            date_valeur="2026-03-15",
            libelle=f"Virement très long libellé numéro {i} — client accentué éàü",
            facture_numero=f"FA-2026-{i:06d}", methode="numero_facture", certain=True,
        )
        for i in range(120)
    ]
    rapport = _rapport(ca_retenu=1000.0, rapprochement=rappro)
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_beaucoup_d_alertes_paginent_sans_planter():
    rapport = _rapport(alertes=[
        Alerte(niveau="vigilance", titre=f"Alerte {i}",
               message="Message assez long pour occuper plusieurs lignes " * 4)
        for i in range(40)
    ])
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


@pytest.mark.parametrize("iso,attendu", [
    ("2026-03-15", "15/03/2026"),
    ("2026-03-15T10:00:00+00:00", "15/03/2026"),
    (None, "—"),
    ("", "—"),
])
def test_dates_rendues_au_format_francais(iso, attendu):
    assert _fr_date(iso) == attendu


def test_une_valeur_non_recoupee_est_dite_telle_quelle():
    """Présenter comme sûr un chiffre non vérifié serait le pire des silences."""
    texte = _texte_provenance({
        "impot_revenu": {"fichier": "data/impot_revenu.yaml", "annee": 2026,
                         "date_verif": "2026-08-03", "verifie": False},
    })
    assert "NON RECOUPÉ" in texte


def test_provenance_vide_le_dit():
    assert "non renseignée" in _texte_provenance({})
