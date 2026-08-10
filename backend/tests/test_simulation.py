"""API des scénarios « et si… ».

Ce que ces tests protègent, dans l'ordre d'importance :

  1. **Le router ne calcule rien.** Tous les montants viennent de `app.agents.impots.moteur`.
     Un test compare donc la sortie de l'API à un appel direct du moteur : s'ils divergent,
     c'est qu'une formule a été réécrite quelque part, exactement ce que l'architecture
     interdit.
  2. **Le non-calculable reste non calculé.** Sans parts fiscales ni autres revenus, l'IR au
     barème doit remonter à `None` avec `ir_bareme_calculable` à faux — jamais un zéro, qui
     se lirait « vous ne paierez rien ».
  3. **Une variante ne diffère de la base que par son delta.** Comparer deux simulations qui
     n'ont pas le même foyer ou la même caisse ne veut rien dire.
  4. **Un dépassement de plafond est signalé** sans être présenté comme une sortie de régime,
     qui suppose deux années consécutives que ce moteur ne connaît pas.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from app.agents.impots.constantes import CaisseBNC, CategorieFiscale
from app.agents.impots.moteur import simuler
from app.agents.impots.schemas import ActiviteCA, ContexteFoyer, DemandeSimulation
from app.api import simulation as api
from app.schemas.auth import UserAgentContext, UserPublic
from app.schemas.orchestrator import UserProfile

UID = "u-sim"
_FACTURES: List[Dict[str, Any]] = []


@pytest.fixture(autouse=True)
def factures(monkeypatch):
    """`simulation` importe `facture_store` par `from … import` : le nom est lié dans CE
    module, c'est donc lui qu'il faut patcher."""
    _FACTURES.clear()
    monkeypatch.setattr(
        api.facture_store, "lister_emises", lambda uid, depuis=None, jusqua=None: _FACTURES
    )
    yield


def _facture(net: float, categorie: str = "prestation", type_document: str = "facture"):
    _FACTURES.append({
        "id": f"id-{len(_FACTURES)}",
        "numero": f"LM-{len(_FACTURES)}",
        "type_document": type_document,
        "total_ht": net,
        "date_emission": "2026-03-01",
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie, "taux_tva": 0.0}],
    })


def _user(profil: UserProfile | None = None) -> UserPublic:
    contexte = UserAgentContext()
    if profil is not None:
        contexte.intake.profile = profil.model_dump()
    return UserPublic(
        id=UID, email="a@b.c", name="Test", created_at="2026-01-01T00:00:00Z",
        agent_context=contexte,
    )


_FOYER_COMPLET = ContexteFoyer(parts=1.0, autres_revenus=0.0, en_couple=False, rfr_n2=20000.0)


def _base(ca: float = 30000.0, foyer: ContexteFoyer | None = None) -> DemandeSimulation:
    return DemandeSimulation(
        activites=[ActiviteCA(categorie=CategorieFiscale.bnc, ca=ca)],
        foyer=foyer if foyer is not None else _FOYER_COMPLET,
    )


# --------------------------------------------------------------------- Cas nominal


def test_le_router_ne_recalcule_rien_lui_meme():
    """Le résultat servi par l'API est celui du moteur, au centime près."""
    demande = api.DemandeScenarios(base=_base(), variantes=[])
    reponse = asyncio.run(api.scenarios(demande, user=_user()))

    attendu = simuler(_base())
    servi = reponse.scenarios[0].resultat

    assert servi.ca_total == attendu.ca_total
    assert servi.cotisations_sociales == attendu.cotisations_sociales
    assert servi.cfp == attendu.cfp
    assert servi.ir_bareme == attendu.ir_bareme
    assert servi.total_prelevements == attendu.total_prelevements
    assert servi.revenu_net_estime == attendu.revenu_net_estime


def test_une_variante_ajoute_son_delta_et_herite_du_reste():
    demande = api.DemandeScenarios(
        base=_base(ca=30000.0),
        variantes=[
            api.VarianteScenario(
                id="v1",
                libelle="+ Contrat 5 000 €",
                ajouts=[ActiviteCA(categorie=CategorieFiscale.bnc, ca=5000.0)],
            )
        ],
    )
    reponse = asyncio.run(api.scenarios(demande, user=_user()))

    assert len(reponse.scenarios) == 2
    base, variante = reponse.scenarios
    assert base.id == "base"
    assert variante.resultat.ca_total == 35000.0
    # Le foyer et la caisse doivent être rigoureusement ceux de la base : sans quoi la
    # comparaison porterait sur deux situations différentes.
    assert variante.demande.foyer == base.demande.foyer
    assert variante.demande.caisse_bnc == base.demande.caisse_bnc
    # Le surcroît de prélèvements est positif : plus de CA, plus de cotisations.
    assert variante.resultat.total_prelevements > base.resultat.total_prelevements


def test_une_variante_peut_changer_une_option_sans_toucher_au_ca():
    demande = api.DemandeScenarios(
        base=_base(),
        variantes=[
            api.VarianteScenario(id="v", libelle="Avec ACRE", acre_active=True),
            api.VarianteScenario(id="c", libelle="CIPAV", caisse_bnc=CaisseBNC.cipav),
        ],
    )
    reponse = asyncio.run(api.scenarios(demande, user=_user()))
    base, acre, cipav = reponse.scenarios

    assert acre.demande.acre_active is True
    assert base.demande.acre_active is False
    assert acre.resultat.acre_appliquee is True
    # L'ACRE allège les cotisations : c'est tout l'intérêt de la comparer.
    assert acre.resultat.cotisations_sociales < base.resultat.cotisations_sociales
    assert cipav.demande.caisse_bnc == CaisseBNC.cipav
    assert cipav.demande.acre_active is False  # l'option de l'autre variante ne déborde pas


def test_les_ajouts_se_cumulent_par_categorie():
    """Un ajout sur une catégorie déjà présente s'additionne au lieu de créer un doublon —
    deux lignes BNC dans la même simulation fausseraient l'abattement."""
    demande = api.DemandeScenarios(
        base=_base(ca=10000.0),
        variantes=[
            api.VarianteScenario(
                id="v",
                libelle="Mixte",
                ajouts=[
                    ActiviteCA(categorie=CategorieFiscale.bnc, ca=2000.0),
                    ActiviteCA(categorie=CategorieFiscale.bic_vente, ca=3000.0),
                ],
            )
        ],
    )
    variante = asyncio.run(api.scenarios(demande, user=_user())).scenarios[1]
    categories = [a.categorie for a in variante.demande.activites]

    assert len(categories) == len(set(categories))
    par_categorie = {a.categorie: a.ca for a in variante.demande.activites}
    assert par_categorie[CategorieFiscale.bnc] == 12000.0
    assert par_categorie[CategorieFiscale.bic_vente] == 3000.0


# ------------------------------------------------------------------ Non calculable


def test_sans_foyer_l_ir_reste_non_calcule():
    """FR-08 : le moteur refuse, l'API répercute. Aucun zéro de complaisance."""
    demande = api.DemandeScenarios(base=_base(foyer=ContexteFoyer()), variantes=[])
    reponse = asyncio.run(api.scenarios(demande, user=_user()))
    resultat = reponse.scenarios[0].resultat

    assert resultat.ir_bareme_calculable is False
    assert resultat.ir_bareme is None
    assert resultat.ir_retenu is None
    assert resultat.total_prelevements is None
    assert resultat.revenu_net_estime is None
    # Les cotisations, elles, ne dépendent pas du foyer : elles restent calculées.
    assert resultat.cotisations_sociales > 0


def test_les_champs_manquants_sont_nommes_avec_leur_consequence():
    demande = api.DemandeScenarios(base=_base(foyer=ContexteFoyer()), variantes=[])
    reponse = asyncio.run(api.scenarios(demande, user=_user()))
    champs = {c.champ for c in reponse.champs_manquants}

    assert champs == {"parts", "autres_revenus", "rfr_n2"}
    assert all(c.libelle and c.consequence for c in reponse.champs_manquants)


def test_un_foyer_complet_ne_manque_de_rien():
    demande = api.DemandeScenarios(base=_base(), variantes=[])
    reponse = asyncio.run(api.scenarios(demande, user=_user()))
    assert reponse.champs_manquants == []


# --------------------------------------------------------------- Dépassement de plafond


def test_un_depassement_de_plafond_est_signale():
    demande = api.DemandeScenarios(
        base=_base(ca=1000.0),
        variantes=[
            api.VarianteScenario(
                id="gros",
                libelle="+ Contrat 100 000 €",
                ajouts=[ActiviteCA(categorie=CategorieFiscale.bnc, ca=100000.0)],
            )
        ],
    )
    reponse = asyncio.run(api.scenarios(demande, user=_user()))
    base, variante = reponse.scenarios

    assert base.resultat.depassements == []
    assert len(variante.resultat.depassements) == 1
    depassement = variante.resultat.depassements[0]
    assert depassement.categorie == CategorieFiscale.bnc
    assert depassement.ca > depassement.plafond


# ------------------------------------------------------------------------ Contexte


def test_le_contexte_ventile_le_ca_reel_par_categorie():
    _facture(4000.0, categorie="prestation")
    _facture(1500.0, categorie="vente")
    profil = UserProfile(fiscal_category="BNC", fiscal_parts=1.0, other_household_income=0.0)

    contexte = asyncio.run(api.contexte(user=_user(profil)))
    par_categorie = {a.categorie: a.ca for a in contexte.base.activites}

    assert par_categorie[CategorieFiscale.bnc] == 4000.0
    assert par_categorie[CategorieFiscale.bic_vente] == 1500.0
    assert contexte.nb_factures_prises_en_compte == 2


def test_un_avoir_reduit_le_ca():
    _facture(5000.0, categorie="prestation")
    _facture(1000.0, categorie="prestation", type_document="avoir")

    contexte = asyncio.run(api.contexte(user=_user()))
    par_categorie = {a.categorie: a.ca for a in contexte.base.activites}

    assert par_categorie[CategorieFiscale.bnc] == 4000.0


def test_sans_facture_le_contexte_reste_calculable():
    """Le moteur exige au moins une activité : un CA nul est un résultat, pas un trou."""
    contexte = asyncio.run(api.contexte(user=_user()))

    assert len(contexte.base.activites) == 1
    assert contexte.base.activites[0].ca == 0.0
    assert "Aucune facture" in contexte.ca_source
    # Et la simulation doit tourner sur ce contexte vide sans lever.
    resultat = simuler(contexte.base)
    assert resultat.ca_total == 0.0


def test_le_contexte_n_invente_jamais_le_foyer():
    """Ni le SIRENE ni le RNE ne connaissent le foyer fiscal : sans déclaration de
    l'utilisateur, ces champs restent vides et l'écran le dira."""
    contexte = asyncio.run(api.contexte(user=_user(UserProfile(fiscal_category="BNC"))))

    assert contexte.base.foyer.parts is None
    assert contexte.base.foyer.autres_revenus is None
    assert {c.champ for c in contexte.champs_manquants} >= {"parts", "autres_revenus"}


def test_le_profil_declare_prime_sur_la_categorie_deduite():
    profil = UserProfile(fiscal_category="BIC_SERVICE", tax_category="BNC")
    assert api._categorie_par_defaut(profil) == CategorieFiscale.bic_service


def test_un_profil_illisible_ne_casse_pas_la_simulation():
    user = _user()
    user.agent_context.intake.profile = {"fiscal_parts": "pas un nombre"}
    contexte = asyncio.run(api.contexte(user=user))
    assert contexte.base.activites[0].ca == 0.0


# ------------------------------------------------------------------ Franchise de TVA


def test_le_seuil_de_tva_se_franchit_avant_le_plafond_du_regime():
    """Les deux seuils sont distincts, et c'est tout l'intérêt de l'alerte : on peut devoir
    facturer la TVA en restant micro-entrepreneur."""
    demande = api.DemandeScenarios(
        base=_base(ca=10000.0),
        variantes=[
            api.VarianteScenario(
                id="v",
                libelle="+ 30 000 €",
                ajouts=[ActiviteCA(categorie=CategorieFiscale.bnc, ca=30000.0)],
            )
        ],
    )
    base, variante = asyncio.run(api.scenarios(demande, user=_user())).scenarios

    assert base.alerte_tva is None  # 10 000 € : le seuil est loin, on ne crie pas
    assert variante.alerte_tva is not None
    assert variante.alerte_tva.niveau in {"depasse_base", "depasse_majore"}
    # Aucun plafond de régime n'est franchi pour autant.
    assert variante.resultat.depassements == []


def test_l_alerte_tva_retient_le_niveau_le_plus_severe():
    demande = api.DemandeScenarios(
        base=DemandeSimulation(
            activites=[
                ActiviteCA(categorie=CategorieFiscale.bnc, ca=50000.0),
                ActiviteCA(categorie=CategorieFiscale.bic_vente, ca=1000.0),
            ],
            foyer=_FOYER_COMPLET,
        ),
        variantes=[],
    )
    alerte = asyncio.run(api.scenarios(demande, user=_user())).scenarios[0].alerte_tva

    assert alerte is not None
    assert alerte.niveau == "depasse_majore"
    # Le message et la note viennent du module réglementaire, pas de ce router.
    assert alerte.message
    assert alerte.note


# ------------------------------------------------------------------- Interprétation


def _repond(monkeypatch, charge):
    """Branche une sortie de modèle figée à la place de l'appel réseau."""
    async def _faux(*args, **kwargs):
        return charge

    monkeypatch.setattr(api, "chat_json_with_system", _faux)


def _interpreter(phrase: str = "si je signe ce contrat de 5000 €"):
    return asyncio.run(api.interpreter(api.DemandeInterpretation(phrase=phrase), user=_user()))


def test_l_interpretation_indisponible_renvoie_un_refus_explicite(monkeypatch):
    """Sans modèle, l'écran le dit — il n'invente pas un scénario pour meubler."""
    async def _indispo(*args, **kwargs):
        raise api.MistralIndisponible("pas de clé")

    monkeypatch.setattr(api, "chat_json_with_system", _indispo)
    resultat = _interpreter()

    assert resultat.comprise is False
    assert resultat.scenarios == []
    assert resultat.motif


def test_une_phrase_sans_montant_n_est_pas_interpretee(monkeypatch):
    _repond(monkeypatch, {"comprise": True, "scenarios": [{"montant": None, "categorie": "BNC"}]})
    resultat = _interpreter("et si je signais ?")

    assert resultat.comprise is False
    assert resultat.scenarios == []


def test_une_phrase_interpretable_ressort_structuree(monkeypatch):
    _repond(monkeypatch, {
        "comprise": True,
        "resume": "Un contrat unique de 5 000 € en prestation libérale.",
        "scenarios": [{
            "libelle": "Contrat 5 000 €", "montant": 5000.0, "categorie": "BNC",
            "recurrent": False, "montant_explicite": True, "categorie_explicite": True,
        }],
    })
    resultat = _interpreter()

    assert resultat.comprise is True
    assert len(resultat.scenarios) == 1
    scenario = resultat.scenarios[0]
    assert scenario.montant == 5000.0
    assert scenario.ca_annuel == 5000.0
    assert scenario.categorie == CategorieFiscale.bnc
    assert scenario.propose is False
    assert resultat.resume


def test_une_phrase_peut_porter_plusieurs_scenarios(monkeypatch):
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [
            {"libelle": "Client A", "montant": 3000.0, "categorie": "BNC"},
            {"libelle": "Client B", "montant": 8000.0, "categorie": "BIC_VENTE"},
        ],
    })
    resultat = _interpreter("deux clients, un à 3000 € et un à 8000 €")

    assert [s.libelle for s in resultat.scenarios] == ["Client A", "Client B"]
    assert [s.montant for s in resultat.scenarios] == [3000.0, 8000.0]
    assert len({s.id for s in resultat.scenarios}) == 2  # identifiants distincts


def test_le_nombre_de_scenarios_est_plafonne(monkeypatch):
    """Au-delà, les courbes épuiseraient les quatre teintes catégorielles validées."""
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{"montant": 1000.0 * i} for i in range(1, 8)],
    })
    resultat = _interpreter()

    assert len(resultat.scenarios) == api._MAX_SCENARIOS


def test_la_recurrence_multiplie_le_ca_annuel(monkeypatch):
    """Un contrat mensuel de 2 000 € sur 6 mois ajoute 12 000 € à l'année, pas 2 000."""
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{
            "libelle": "Mensuel", "montant": 2000.0, "categorie": "BNC",
            "recurrent": True, "mois": 6, "recurrence_explicite": True,
        }],
    })
    scenario = _interpreter().scenarios[0]

    assert scenario.montant == 2000.0  # une échéance
    assert scenario.ca_annuel == 12000.0  # l'année
    assert any(e.champ == "duree" and e.libelle == "sur 6 mois" for e in scenario.elements)


def test_un_recurrent_sans_duree_court_jusqu_a_la_fin_de_l_annee(monkeypatch):
    """Hypothèse défavorable assumée : c'est le franchissement du plafond qu'il faut voir."""
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{"montant": 2000.0, "recurrent": True, "mois": None}],
    })
    scenario = _interpreter().scenarios[0]

    assert scenario.ca_annuel == 24000.0
    assert any(e.champ == "duree" and e.libelle == "sur 12 mois" for e in scenario.elements)


def test_la_provenance_distingue_le_lu_du_suppose(monkeypatch):
    """Le cœur de l'écran : l'utilisateur doit voir ce qu'il a dit et ce qu'on a deviné."""
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{
            "libelle": "Contrat", "montant": 5000.0, "categorie": "BNC",
            "montant_explicite": True, "categorie_explicite": False,
        }],
    })
    elements = {e.champ: e.provenance for e in _interpreter().scenarios[0].elements}

    assert elements["montant"] == "explicite"
    assert elements["categorie"] == "suppose"


def test_une_categorie_absente_est_toujours_une_supposition(monkeypatch):
    """Même si le modèle se dit sûr : sans catégorie, il n'a rien lu à confirmer."""
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{"montant": 5000.0, "categorie": None, "categorie_explicite": True}],
    })
    scenario = _interpreter().scenarios[0]
    element = next(e for e in scenario.elements if e.champ == "categorie")

    assert scenario.categorie is None
    assert element.provenance == "suppose"
    assert element.libelle == "nature à préciser"


def test_les_contre_scenarios_sont_marques_comme_proposes(monkeypatch):
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [{"libelle": "Contrat", "montant": 5000.0}],
        "contre_scenarios": [
            {"libelle": "La moitié", "montant": 2500.0},
            {"libelle": "Deux fois", "montant": 10000.0},
            {"libelle": "En trop", "montant": 99.0},
        ],
    })
    resultat = _interpreter()

    assert len(resultat.contre_scenarios) == api._MAX_CONTRE_SCENARIOS
    assert all(s.propose for s in resultat.contre_scenarios)
    assert all(not s.propose for s in resultat.scenarios)


def test_les_entrees_hors_contrat_sont_ecartees_sans_faire_tomber_le_reste(monkeypatch):
    _repond(monkeypatch, {
        "comprise": True,
        "scenarios": [
            "pas un objet",
            {"montant": "beaucoup"},
            {"montant": -500.0},
            {"montant": True},          # bool est un int en Python : doit être refusé
            {"montant": 4000.0, "categorie": "PAS_UNE_CATEGORIE", "mois": 99},
        ],
    })
    resultat = _interpreter()

    assert len(resultat.scenarios) == 1
    scenario = resultat.scenarios[0]
    assert scenario.montant == 4000.0
    assert scenario.categorie is None  # catégorie inconnue ignorée, pas propagée
    assert scenario.mois is None       # 99 hors bornes


def test_une_sortie_de_modele_qui_n_est_pas_un_objet_est_refusee(monkeypatch):
    _repond(monkeypatch, ["une", "liste"])
    assert _interpreter().comprise is False
