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
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agents.facture import store as facture_store
from app.agents.facture.generator import _ligne_totaux, alerte_seuil_tva
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


class AlerteTva(BaseModel):
    """Franchise en base de TVA — la conséquence la plus concrète d'un contrat signé.

    Le plafond du RÉGIME et le seuil de FRANCHISE DE TVA sont deux choses distinctes, et
    le second se franchit bien plus tôt. Un contrat peut donc obliger à facturer la TVA
    sans rien changer au régime micro : c'est ce que cette alerte rend visible.

    Le calcul vient de `app.agents.facture.generator.alerte_seuil_tva`, qui lit les seuils
    réglementaires du projet. Rien n'est recalculé ici.
    """

    niveau: str
    message: str
    seuil_base: Optional[float] = None
    seuil_majore: Optional[float] = None
    note: Optional[str] = None
    source: Optional[str] = None


class ScenarioCalcule(BaseModel):
    id: str
    libelle: str
    # La demande effectivement calculée accompagne le résultat : l'utilisateur doit pouvoir
    # vérifier sur quelles hypothèses un chiffre a été produit.
    demande: DemandeSimulation
    resultat: ResultatSimulation
    # `None` quand le seuil est encore loin : l'agent ne crie pas sans raison.
    alerte_tva: Optional[AlerteTva] = None


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


Provenance = Literal["explicite", "suppose"]


class ElementCompris(BaseModel):
    """Un paramètre extrait de la phrase, avec l'origine de sa valeur.

    `provenance` est la pièce maîtresse de l'écran. Une saisie en langage naturel n'est
    honnête que si l'utilisateur peut distinguer ce qu'il a DIT de ce que la machine a
    DEVINÉ à sa place : confondre les deux, c'est lui faire porter une erreur qui n'est
    pas la sienne. Une supposition doit se voir et se corriger.
    """

    champ: Literal["montant", "categorie", "recurrence", "duree"]
    libelle: str = Field(description="Ce qui est affiché à l'utilisateur, en toutes lettres")
    provenance: Provenance


class ScenarioInterprete(BaseModel):
    """Un scénario compris dans la phrase, prêt à devenir une variante.

    `montant` est le CA de la période, pas un montant d'impôt : le modèle ne calcule rien.
    """

    id: str
    libelle: str
    montant: float = Field(gt=0, description="CA HT ajouté, hors récurrence")
    categorie: Optional[CategorieFiscale] = None
    recurrent: bool = False
    mois: Optional[int] = Field(default=None, ge=1, le=12)
    # CA effectivement ajouté sur l'année, récurrence appliquée. Voir `_ca_annuel`.
    ca_annuel: float = 0.0
    elements: List[ElementCompris] = Field(default_factory=list)
    # Vrai pour un contre-scénario proposé par le modèle, faux pour ce que la phrase dit.
    propose: bool = False


class InterpretationScenario(BaseModel):
    """Ce que le modèle a compris — proposé, jamais appliqué d'office.

    Le modèle TRADUIT une phrase en paramètres. Il ne produit aucun montant d'impôt : le
    calcul appartient au moteur. `comprise` à faux signale qu'aucun scénario n'est
    exploitable et que l'écran doit demander une reformulation.
    """

    comprise: bool
    resume: Optional[str] = None
    motif: Optional[str] = None
    # Ce que la phrase décrit. Plusieurs entrées si elle contient plusieurs scénarios.
    scenarios: List[ScenarioInterprete] = Field(default_factory=list)
    # Comparaisons utiles suggérées par le modèle. L'utilisateur les accepte ou les écarte —
    # elles ne sont JAMAIS appliquées d'office, sans quoi il subirait des chiffres qu'il
    # n'a pas demandés.
    contre_scenarios: List[ScenarioInterprete] = Field(default_factory=list)


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


def _alerte_tva(demande: DemandeSimulation) -> Optional[AlerteTva]:
    """Alerte de franchise TVA pour un scénario.

    Le seuil de franchise dépend de la nature de l'activité : on interroge la catégorie qui
    porte le plus de chiffre d'affaires, et on retient l'alerte la plus sévère rencontrée.
    """
    pire: Optional[Dict[str, Any]] = None
    rang = {"proche": 1, "depasse_base": 2, "depasse_majore": 3}

    for activite in demande.activites:
        nature = "vente" if activite.categorie == CategorieFiscale.bic_vente else "services"
        alerte = alerte_seuil_tva(activite.ca, nature)
        if alerte is None:
            continue
        if pire is None or rang.get(alerte["niveau"], 0) > rang.get(pire["niveau"], 0):
            pire = alerte

    return AlerteTva.model_validate(pire) if pire else None


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
            alerte_tva=_alerte_tva(demande.base),
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
                alerte_tva=_alerte_tva(appliquee),
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
s'en charge. Tu extrais uniquement ce que la phrase dit, et tu déclares ce que tu supposes.

Réponds avec cet objet JSON :
{
  "comprise": true|false,
  "resume": "une phrase disant ce que tu as compris, en français",
  "motif": "si comprise vaut false, ce qui manque dans la phrase",
  "scenarios": [
    {
      "libelle": "étiquette courte, ex. « Contrat 5 000 € »",
      "montant": nombre en euros HT (le montant d'UNE occurrence, pas le total annuel),
      "categorie": "BIC_VENTE" | "BIC_SERVICE" | "BNC" | null,
      "recurrent": true|false,
      "mois": nombre de mois si récurrent, sinon null,
      "montant_explicite": true|false,
      "categorie_explicite": true|false,
      "recurrence_explicite": true|false
    }
  ],
  "contre_scenarios": [ même forme, 0 à 2 entrées ]
}

Règles :
- "BIC_VENTE" = vente de marchandises ou de biens. "BIC_SERVICE" = prestation de services
  commerciale. "BNC" = prestation libérale, conseil, création de contenu, sponsoring.
- En cas de doute sur la catégorie, mets null : l'écran la demandera.
- Une phrase peut contenir PLUSIEURS scénarios (« deux clients à 3 000 € et un à 8 000 »).
  Mets-en un par entrée de "scenarios", au maximum 3.
- Pour un contrat récurrent, "montant" est le montant d'UNE échéance et "mois" leur nombre.
  Ne multiplie pas toi-même : le serveur s'en charge.
- Les champs "*_explicite" disent si la valeur est LUE dans la phrase (true) ou SUPPOSÉE
  par toi (false). Sois honnête : une supposition annoncée vaut mieux qu'une erreur muette.
- "contre_scenarios" : au plus deux comparaisons utiles que l'utilisateur n'a pas demandées
  mais qu'il a intérêt à voir (le même contrat à la moitié, deux fois ce contrat…).
  Donne-leur un libellé qui dit clairement que c'est une hypothèse alternative.
- Si aucun montant n'est identifiable nulle part, "comprise" vaut false et "scenarios" est vide.
"""

_REFUS_INDISPONIBLE = (
    "L'interprétation automatique est indisponible. Reformulez ou réessayez dans un moment."
)
_REFUS_INCOMPRIS = (
    "La phrase n'a pas pu être interprétée. Précisez un montant, par exemple "
    "« un contrat de 5 000 € en prestation »."
)


def _ca_annuel(montant: float, recurrent: bool, mois: Optional[int]) -> float:
    """CA ajouté sur l'année civile par un scénario.

    RÈGLE, explicite parce qu'elle change le résultat du simple au double : `montant` est
    le montant d'UNE échéance. Un contrat récurrent ajoute donc `montant × mois`, et un
    récurrent sans durée précisée est traité comme courant jusqu'à la fin de l'année, soit
    douze échéances. C'est l'hypothèse la plus défavorable en termes de plafond — celle qui
    alerte plutôt que celle qui rassure, puisque c'est le franchissement du plafond que
    l'écran doit rendre visible.
    """
    if not recurrent:
        return round(montant, 2)
    echeances = mois if mois is not None and mois > 0 else 12
    return round(montant * min(echeances, 12), 2)


def _element(champ: str, libelle: str, explicite: Any) -> ElementCompris:
    return ElementCompris(
        champ=champ,  # type: ignore[arg-type] — champ vient d'un littéral local
        libelle=libelle,
        provenance="explicite" if explicite is True else "suppose",
    )


def _lire_scenario(brut: Dict[str, Any], index: int, propose: bool) -> Optional[ScenarioInterprete]:
    """Une entrée de la sortie du modèle → un scénario exploitable, ou `None`.

    Toute entrée sans montant utilisable est ÉCARTÉE plutôt que complétée : simuler sur un
    chiffre inventé produirait une réponse fausse d'apparence sûre.
    """
    if not isinstance(brut, dict):
        return None

    montant = brut.get("montant")
    if not isinstance(montant, (int, float)) or isinstance(montant, bool):
        return None
    montant = float(montant)
    if not (montant > 0) or montant != montant or montant in (float("inf"), float("-inf")):
        return None

    categorie_brute = brut.get("categorie")
    categorie = (
        CategorieFiscale(categorie_brute)
        if categorie_brute in {c.value for c in CategorieFiscale}
        else None
    )

    recurrent = bool(brut.get("recurrent"))
    mois_brut = brut.get("mois")
    mois = int(mois_brut) if isinstance(mois_brut, int) and 1 <= mois_brut <= 12 else None

    libelle = brut.get("libelle")
    if not isinstance(libelle, str) or not libelle.strip():
        libelle = f"Scénario {index + 1}"

    elements = [
        _element("montant", f"{montant:,.0f} € HT".replace(",", " "), brut.get("montant_explicite")),
        _element(
            "categorie",
            _LIBELLE_CATEGORIE.get(categorie, "nature à préciser"),
            brut.get("categorie_explicite") if categorie is not None else False,
        ),
        _element(
            "recurrence",
            "contrat récurrent" if recurrent else "contrat unique",
            brut.get("recurrence_explicite"),
        ),
    ]
    if recurrent:
        elements.append(
            _element(
                "duree",
                f"sur {mois} mois" if mois else "sur 12 mois",
                mois is not None and brut.get("recurrence_explicite") is True,
            )
        )

    return ScenarioInterprete(
        id=f"{'contre' if propose else 'sc'}-{index}",
        libelle=libelle.strip(),
        montant=montant,
        categorie=categorie,
        recurrent=recurrent,
        mois=mois,
        ca_annuel=_ca_annuel(montant, recurrent, mois),
        elements=elements,
        propose=propose,
    )


_LIBELLE_CATEGORIE = {
    CategorieFiscale.bic_vente: "vente de marchandises",
    CategorieFiscale.bic_service: "prestation commerciale",
    CategorieFiscale.bnc: "prestation libérale",
    None: "nature à préciser",
}

# Trois scénarios décrits + la base saturent déjà les quatre teintes catégorielles
# validées de la charte dataviz ; les contre-scénarios se substituent, ils ne s'ajoutent pas.
_MAX_SCENARIOS = 3
_MAX_CONTRE_SCENARIOS = 2


@router.post("/interpreter", response_model=InterpretationScenario)
async def interpreter(demande: DemandeInterpretation, user: UserPublic = Depends(get_current_user)):
    """Traduit une phrase en paramètres. Le résultat est une PROPOSITION corrigeable.

    Le modèle n'est jamais sur le chemin d'un montant fiscal : il choisit un CA, une nature
    et une récurrence, le moteur fait le reste. Toute sortie hors contrat est écartée en
    silence plutôt que rattrapée : un scénario à demi compris vaut moins que pas de scénario.
    """
    try:
        brut: Dict[str, Any] = await chat_json_with_system(
            _SYSTEME_INTERPRETATION, demande.phrase, temperature=0.0, max_tokens=900
        )
    except MistralIndisponible as exc:
        logger.info("Interprétation indisponible : %s", exc)
        return InterpretationScenario(comprise=False, motif=_REFUS_INDISPONIBLE)
    except Exception as exc:  # noqa: BLE001 — une extraction ratée n'est pas une panne d'écran
        logger.warning("Interprétation en échec : %s", exc)
        return InterpretationScenario(comprise=False, motif=_REFUS_INCOMPRIS)

    if not isinstance(brut, dict):
        return InterpretationScenario(comprise=False, motif=_REFUS_INCOMPRIS)

    scenarios = [
        s
        for i, entree in enumerate(brut.get("scenarios") or [])
        if (s := _lire_scenario(entree, i, propose=False)) is not None
    ][:_MAX_SCENARIOS]

    if not scenarios:
        motif = brut.get("motif")
        return InterpretationScenario(
            comprise=False,
            motif=motif if isinstance(motif, str) and motif.strip() else _REFUS_INCOMPRIS,
        )

    contre = [
        s
        for i, entree in enumerate(brut.get("contre_scenarios") or [])
        if (s := _lire_scenario(entree, i, propose=True)) is not None
    ][:_MAX_CONTRE_SCENARIOS]

    resume = brut.get("resume")
    return InterpretationScenario(
        comprise=True,
        resume=resume.strip() if isinstance(resume, str) and resume.strip() else None,
        scenarios=scenarios,
        contre_scenarios=contre,
    )
