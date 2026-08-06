"""API des scénarios « et si… » — comparaison de variantes fiscales.

Ce module NE CALCULE RIEN. Comme `app.agents.declarations` et `app.agents.rapport_fiscal`,
il assemble un contexte et délègue l'intégralité du calcul à `app.agents.impots.moteur` :
abattements, IR au barème, versement libératoire, cotisations, CFP, ACRE et contrôle des
plafonds. Toute formule fiscale écrite ici serait une seconde vérité, vouée à diverger de
la première.

La règle FR-08 traverse tout le fichier : ce qui n'est pas calculable reste `None` et
remonte tel quel jusqu'à l'écran. Un foyer non renseigné donne « IR non calculable », pas
zéro euro — un zéro se lit comme « vous ne paierez rien », ce qui est faux et coûteux.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agents.facture import store as facture_store
from app.agents.facture.generator import _ligne_totaux
from app.agents.facture.schemas import LigneFacture
from app.agents.impots.constantes import CaisseBNC, CategorieFiscale
from app.agents.impots.moteur import plafond_applicable, simuler
from app.agents.impots.schemas import (
    ActiviteCA,
    ContexteFoyer,
    DemandeSimulation,
    ResultatSimulation,
)
from app.api.deps import get_current_user
from app.llm import MistralIndisponible, chat_json_with_system
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

# Nature d'une ligne de facture -> catégorie fiscale du moteur. Même correspondance que
# `app.agents.rapport_fiscal.orchestrateur` : une vente et une prestation n'ont ni le même
# abattement ni le même taux de cotisations, les agréger serait faux.
_CATEGORIE_PAR_NATURE: Dict[str, Optional[CategorieFiscale]] = {
    "vente": CategorieFiscale.bic_vente,
    "prestation": None,  # dépend du profil déclaré
}

_MAX_VARIANTES = 6


# --------------------------------------------------------------------------- Schémas


class ChampManquant(BaseModel):
    """Une donnée que seul l'utilisateur connaît, et son effet sur le calcul."""

    champ: str
    libelle: str
    consequence: str


class VarianteScenario(BaseModel):
    """Un delta appliqué au contexte de base — jamais un contexte complet.

    Comparer deux simulations n'a de sens que si elles ne diffèrent que par ce que
    l'utilisateur veut tester : le reste du contexte doit être rigoureusement identique.
    """

    id: str
    libelle: str
    ajouts: List[ActiviteCA] = Field(
        default_factory=list, description="CA supplémentaire, par catégorie"
    )
    option_versement_liberatoire: Optional[bool] = Field(
        default=None, description="None = hérite du contexte de base"
    )
    acre_active: Optional[bool] = Field(default=None, description="None = hérite de la base")
    caisse_bnc: Optional[CaisseBNC] = Field(default=None, description="None = hérite de la base")


class DemandeScenarios(BaseModel):
    base: DemandeSimulation
    variantes: List[VarianteScenario] = Field(default_factory=list, max_length=_MAX_VARIANTES)


class ScenarioCalcule(BaseModel):
    id: str
    libelle: str
    # La demande effectivement calculée accompagne le résultat : l'utilisateur doit pouvoir
    # vérifier sur quelles hypothèses un chiffre a été produit.
    demande: DemandeSimulation
    resultat: ResultatSimulation


class PlafondCategorie(BaseModel):
    """Plafond du régime, par catégorie.

    `ResultatSimulation.depassements` ne porte le plafond QUE lorsqu'il est franchi.
    L'écran, lui, doit tracer la ligne de repère même quand on reste dessous : le plafond
    vient donc d'ici, c'est-à-dire de `app.agents.impots.constantes`, et jamais d'une
    constante recopiée dans le front.
    """

    categorie: CategorieFiscale
    plafond: float
    proratise: bool


class ReponseScenarios(BaseModel):
    """`scenarios[0]` est toujours la base ; les suivants sont les variantes, dans l'ordre."""

    scenarios: List[ScenarioCalcule]
    champs_manquants: List[ChampManquant]
    plafonds: List[PlafondCategorie]


class ContexteSimulation(BaseModel):
    base: DemandeSimulation
    champs_manquants: List[ChampManquant]
    ca_source: str = Field(description="D'où vient le CA pré-rempli — jamais présenté comme acquis")
    annee: int
    nb_factures_prises_en_compte: int


class DemandeInterpretation(BaseModel):
    phrase: str = Field(min_length=3, max_length=500)


class InterpretationScenario(BaseModel):
    """Ce que le modèle a compris — proposé, jamais appliqué d'office.

    Le modèle TRADUIT une phrase en paramètres. Il ne produit aucun montant d'impôt : le
    calcul appartient au moteur. `comprise` à faux signale qu'il faut passer par le
    formulaire plutôt que d'inventer un scénario.
    """

    comprise: bool
    montant: Optional[float] = None
    categorie: Optional[CategorieFiscale] = None
    recurrent: bool = False
    mois: Optional[int] = Field(default=None, ge=1, le=12)
    libelle: Optional[str] = None
    resume: Optional[str] = None
    motif: Optional[str] = None


# ---------------------------------------------------------------------- Pré-remplissage


def _profil_optionnel(user: UserPublic) -> Optional[UserProfile]:
    """Profil vérifié s'il existe. Contrairement au Centre d'Actions, la simulation reste
    ouverte à un compte non vérifié : on peut vouloir tester un scénario AVANT de
    s'immatriculer. Le contexte est simplement vide, et l'écran le dit."""
    brut = getattr(getattr(user.agent_context, "intake", None), "profile", None)
    if not brut:
        return None
    try:
        return UserProfile.model_validate(brut)
    except Exception:  # noqa: BLE001 — un profil illisible ne doit pas casser la simulation
        logger.warning("Profil illisible pour l'utilisateur %s : simulation sans pré-remplissage", user.id)
        return None


def _categorie_par_defaut(profil: Optional[UserProfile]) -> CategorieFiscale:
    """Catégorie retenue quand la ligne de facture ne permet pas de trancher.

    `fiscal_category` est DÉCLARÉE par l'utilisateur et distingue vente et prestation ;
    `tax_category` n'est qu'une déduction BIC/BNC. On préfère donc la première, et on
    retombe sur BNC — le cas le plus fréquent chez les freelances et créateurs.
    """
    if profil is None:
        return CategorieFiscale.bnc
    declaree = profil.fiscal_category
    if declaree in {c.value for c in CategorieFiscale}:
        return CategorieFiscale(declaree)
    if profil.tax_category == "BIC":
        return CategorieFiscale.bic_service
    return CategorieFiscale.bnc


def _ca_par_categorie(factures: List[dict], defaut: CategorieFiscale) -> Dict[CategorieFiscale, float]:
    """Ventile le CA HT des factures émises par catégorie fiscale.

    Arithmétique de document, pas de fiscalité : on additionne des lignes déjà calculées
    par l'agent facture. Aucun taux n'est appliqué ici.
    """
    totaux: Dict[CategorieFiscale, float] = {}
    for facture in factures:
        # Un avoir réduit le chiffre d'affaires : il est déjà exclu par `lister_emises`,
        # mais un document de type `avoir` peut subsister selon le statut.
        signe = -1.0 if facture.get("type_document") == "avoir" else 1.0
        for ligne_brute in facture.get("lignes") or []:
            try:
                ligne = LigneFacture.model_validate(ligne_brute)
            except Exception:  # noqa: BLE001 — une ligne illisible ne fait pas tomber le total
                continue
            ht, _, _ = _ligne_totaux(ligne)
            categorie = _CATEGORIE_PAR_NATURE.get(ligne.categorie) or defaut
            totaux[categorie] = round(totaux.get(categorie, 0.0) + signe * ht, 2)
    return {categorie: montant for categorie, montant in totaux.items() if montant > 0}


def _foyer_depuis_profil(profil: Optional[UserProfile]) -> ContexteFoyer:
    """Foyer fiscal tel que l'utilisateur l'a DÉCLARÉ. Rien n'est supposé ici : sans parts
    ni autres revenus, le moteur refusera l'IR au barème, et c'est le comportement voulu."""
    if profil is None:
        return ContexteFoyer()
    return ContexteFoyer(
        parts=profil.fiscal_parts,
        autres_revenus=profil.other_household_income,
        en_couple=profil.family_status in {"marie", "pacse"},
        rfr_n2=profil.rfr_n_minus_2,
    )


def _champs_manquants(foyer: ContexteFoyer) -> List[ChampManquant]:
    """Ce qui bloque un calcul, nommé précisément — un écran ne peut pas demander à
    l'utilisateur de compléter « son profil » sans lui dire quoi."""
    manquants: List[ChampManquant] = []
    if foyer.parts is None:
        manquants.append(
            ChampManquant(
                champ="parts",
                libelle="Nombre de parts fiscales",
                consequence="Sans lui, l'impôt sur le revenu au barème n'est pas calculé.",
            )
        )
    if foyer.autres_revenus is None:
        manquants.append(
            ChampManquant(
                champ="autres_revenus",
                libelle="Autres revenus du foyer",
                consequence="Sans eux, l'impôt sur le revenu au barème n'est pas calculé.",
            )
        )
    if foyer.rfr_n2 is None:
        manquants.append(
            ChampManquant(
                champ="rfr_n2",
                libelle="Revenu fiscal de référence N-2",
                consequence="Sans lui, l'éligibilité au versement libératoire reste indéterminée.",
            )
        )
    return manquants


def _caisse(profil: Optional[UserProfile]) -> CaisseBNC:
    if profil is not None and profil.bnc_caisse in {c.value for c in CaisseBNC}:
        return CaisseBNC(profil.bnc_caisse)
    return CaisseBNC.regime_general


@router.get("/contexte", response_model=ContexteSimulation)
async def contexte(user: UserPublic = Depends(get_current_user)):
    """Contexte de départ, pré-rempli avec le CA réellement facturé sur l'année civile."""
    profil = _profil_optionnel(user)
    defaut = _categorie_par_defaut(profil)
    annee = date.today().year

    factures = facture_store.lister_emises(
        user.id, depuis=f"{annee}-01-01", jusqua=f"{annee}-12-31"
    )
    ventile = _ca_par_categorie(factures, defaut)

    # Le moteur exige au moins une activité. Un CA nul est un résultat (abattement,
    # cotisations et impôt valent zéro), pas une absence de calcul.
    activites = [ActiviteCA(categorie=cat, ca=ca) for cat, ca in sorted(ventile.items(), key=lambda i: i[0].value)]
    if not activites:
        activites = [ActiviteCA(categorie=defaut, ca=0.0)]

    foyer = _foyer_depuis_profil(profil)
    base = DemandeSimulation(
        activites=activites,
        foyer=foyer,
        caisse_bnc=_caisse(profil),
        acre_active=bool(profil.acre_active) if profil is not None else False,
        option_versement_liberatoire=False,
    )

    return ContexteSimulation(
        base=base,
        champs_manquants=_champs_manquants(foyer),
        ca_source=(
            "Factures émises de l'année en cours"
            if ventile
            else "Aucune facture émise cette année — partez d'un montant saisi à la main"
        ),
        annee=annee,
        nb_factures_prises_en_compte=len(factures),
    )


# --------------------------------------------------------------------------- Scénarios


def _appliquer(base: DemandeSimulation, variante: VarianteScenario) -> DemandeSimulation:
    """Contexte de base + delta. Les activités s'additionnent par catégorie ; toute option
    laissée à `None` dans la variante hérite de la base."""
    activites: Dict[CategorieFiscale, float] = {a.categorie: a.ca for a in base.activites}
    for ajout in variante.ajouts:
        activites[ajout.categorie] = round(activites.get(ajout.categorie, 0.0) + ajout.ca, 2)

    return DemandeSimulation(
        activites=[
            ActiviteCA(categorie=cat, ca=ca)
            for cat, ca in sorted(activites.items(), key=lambda i: i[0].value)
        ],
        foyer=base.foyer,
        caisse_bnc=variante.caisse_bnc if variante.caisse_bnc is not None else base.caisse_bnc,
        acre_active=variante.acre_active if variante.acre_active is not None else base.acre_active,
        option_versement_liberatoire=(
            variante.option_versement_liberatoire
            if variante.option_versement_liberatoire is not None
            else base.option_versement_liberatoire
        ),
        jours_activite=base.jours_activite,
    )


def _plafonds(calcules: List[ScenarioCalcule], jours_activite: Optional[int]) -> List[PlafondCategorie]:
    """Plafonds des catégories effectivement en jeu, base et variantes confondues."""
    categories: List[CategorieFiscale] = []
    for scenario in calcules:
        for activite in scenario.demande.activites:
            if activite.categorie not in categories:
                categories.append(activite.categorie)

    plafonds: List[PlafondCategorie] = []
    for categorie in sorted(categories, key=lambda c: c.value):
        plafond, proratise = plafond_applicable(categorie, jours_activite)
        plafonds.append(
            PlafondCategorie(categorie=categorie, plafond=plafond, proratise=proratise)
        )
    return plafonds


@router.post("/scenarios", response_model=ReponseScenarios)
async def scenarios(demande: DemandeScenarios, user: UserPublic = Depends(get_current_user)):
    """Calcule la base et chaque variante avec le MÊME moteur, sur le MÊME contexte.

    Les dépassements de plafond sont déjà portés par `ResultatSimulation.depassements` :
    `simuler` appelle `controler_plafonds` en interne.
    """
    calcules: List[ScenarioCalcule] = [
        ScenarioCalcule(
            id="base",
            libelle="Situation actuelle",
            demande=demande.base,
            resultat=simuler(demande.base),
        )
    ]

    for variante in demande.variantes:
        appliquee = _appliquer(demande.base, variante)
        calcules.append(
            ScenarioCalcule(
                id=variante.id,
                libelle=variante.libelle,
                demande=appliquee,
                resultat=simuler(appliquee),
            )
        )

    return ReponseScenarios(
        scenarios=calcules,
        champs_manquants=_champs_manquants(demande.base.foyer),
        plafonds=_plafonds(calcules, demande.base.jours_activite),
    )


# --------------------------------------------------------------- Langage naturel

_SYSTEME_INTERPRETATION = """Tu traduis une phrase française en paramètres de simulation fiscale.

Tu ne calcules JAMAIS d'impôt, de cotisation ni de montant net : un moteur déterministe
s'en charge. Tu extrais uniquement ce que la phrase dit.

Réponds avec cet objet JSON :
{
  "comprise": true|false,
  "montant": nombre en euros HT ou null,
  "categorie": "BIC_VENTE" | "BIC_SERVICE" | "BNC" | null,
  "recurrent": true|false,
  "mois": nombre de mois si récurrent, sinon null,
  "libelle": "étiquette courte du scénario, ex. « Contrat 5 000 € »",
  "resume": "une phrase disant ce que tu as compris, en français",
  "motif": "si comprise vaut false, ce qui manque dans la phrase"
}

Règles :
- "BIC_VENTE" = vente de marchandises ou de biens. "BIC_SERVICE" = prestation de services
  commerciale. "BNC" = prestation libérale, conseil, création de contenu, sponsoring.
- En cas de doute sur la catégorie, mets null : le formulaire la demandera.
- Si aucun montant n'est identifiable, "comprise" vaut false.
"""


@router.post("/interpreter", response_model=InterpretationScenario)
async def interpreter(demande: DemandeInterpretation, user: UserPublic = Depends(get_current_user)):
    """Traduit une phrase en paramètres. Le résultat est une PROPOSITION corrigeable.

    Le modèle n'est jamais sur le chemin d'un montant fiscal : il choisit un montant de CA
    et une catégorie, le moteur fait le reste. Si le modèle est indisponible, on le dit —
    le formulaire structuré reste utilisable sans lui.
    """
    try:
        brut: Dict[str, Any] = await chat_json_with_system(
            _SYSTEME_INTERPRETATION, demande.phrase, temperature=0.0, max_tokens=400
        )
    except MistralIndisponible as exc:
        logger.info("Interprétation indisponible : %s", exc)
        return InterpretationScenario(
            comprise=False,
            motif="L'interprétation automatique est indisponible. Renseignez le scénario à la main.",
        )
    except Exception as exc:  # noqa: BLE001 — une extraction ratée n'est pas une panne d'écran
        logger.warning("Interprétation en échec : %s", exc)
        return InterpretationScenario(
            comprise=False,
            motif="La phrase n'a pas pu être interprétée. Renseignez le scénario à la main.",
        )

    try:
        interpretation = InterpretationScenario.model_validate(brut)
    except Exception:  # noqa: BLE001 — sortie de modèle hors contrat
        return InterpretationScenario(
            comprise=False,
            motif="La phrase n'a pas pu être interprétée. Renseignez le scénario à la main.",
        )

    # Un montant absent ou absurde vide le scénario plutôt que de produire une simulation
    # sur un chiffre inventé.
    if interpretation.montant is None or interpretation.montant <= 0:
        return InterpretationScenario(
            comprise=False,
            motif=interpretation.motif or "Aucun montant identifiable dans la phrase.",
        )
    return interpretation
