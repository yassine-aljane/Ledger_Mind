"""Moteur de calcul déterministe — micro-entreprise (France).

AUCUN appel LLM ici, ni maintenant ni plus tard : les agents appellent ce
moteur, ils ne recalculent pas. Un montant d'impôt doit être reproductible et
vérifiable ligne à ligne.

Trois principes portés par le code :

  1. **Rien n'est inventé.** Sans contexte de foyer, l'IR au barème n'est pas
     calculé — il est déclaré non calculable. Un chiffre plausible mais faux
     serait plus nuisible qu'une absence assumée.
  2. **Pleine précision jusqu'au bout.** Les arrondis interviennent au moment
     de l'affichage seulement ; arrondir les étapes fait dériver le barème.
  3. **Toute approximation se signale.** L'ACRE appliquée au taux global, la
     décote « couple » non recoupée : ces réserves remontent dans le résultat.

Référence de calcul : `formules_calcul_impot_micro_entreprise.md`.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from . import constantes as C
from .constantes import CaisseBNC, CategorieFiscale
from .schemas import (
    ActiviteCA,
    ContexteFoyer,
    DemandeSimulation,
    DepassementPlafond,
    DetailIR,
    LigneAbattement,
    ResultatSimulation,
    ResultatVersementLiberatoire,
)

# Nombre de jours servant de dénominateur au prorata de première année.
_JOURS_ANNEE = 365


# --- Étape 1 — base imposable ----------------------------------------------
def calculer_abattement(ca: float, categorie: CategorieFiscale, plancher: float) -> Tuple[float, bool]:
    """Abattement forfaitaire et indicateur d'application du plancher."""
    proportionnel = ca * C.abattement_taux(categorie)
    if proportionnel >= plancher:
        return proportionnel, False
    # Le plancher ne peut pas dépasser le CA : un abattement supérieur au
    # chiffre d'affaires produirait une base imposable négative.
    return min(plancher, ca), True


def calculer_lignes(activites: List[ActiviteCA], mixte: bool) -> List[LigneAbattement]:
    """Une ligne d'abattement par catégorie. En activité mixte, le plancher est doublé."""
    plancher = C.abattement_minimum_mixte() if mixte else C.abattement_minimum()
    lignes: List[LigneAbattement] = []
    for activite in activites:
        abattement, plancher_applique = calculer_abattement(
            activite.ca, activite.categorie, plancher
        )
        lignes.append(
            LigneAbattement(
                categorie=activite.categorie,
                ca=activite.ca,
                taux_abattement=C.abattement_taux(activite.categorie),
                abattement=abattement,
                base_imposable=activite.ca - abattement,
                plancher_applique=plancher_applique,
            )
        )
    return lignes


# --- Étape 2 — barème progressif -------------------------------------------
def impot_sur_quotient(quotient: float) -> float:
    """Impôt dû sur UNE part, par application successive des tranches."""
    if quotient <= 0:
        return 0.0
    total = 0.0
    for tranche in C.bareme_tranches():
        plancher = float(tranche["plancher"])
        if quotient <= plancher:
            continue
        plafond = tranche.get("plafond")
        borne = quotient if plafond is None else min(quotient, float(plafond))
        total += (borne - plancher) * float(tranche["taux"])
    return total


# --- Étapes 3 à 5 — IR d'un foyer ------------------------------------------
def impot_du_foyer(revenu_net_imposable: float, parts: float, en_couple: bool) -> DetailIR:
    """IR net d'un foyer : quotient familial, plafonnement, puis décote."""
    rni = max(0.0, revenu_net_imposable)
    ir_reel = impot_sur_quotient(rni / parts) * parts

    # Étape 4 — l'avantage tiré des demi-parts supplémentaires est plafonné.
    parts_base = C.parts_de_base(en_couple)
    demi_parts_extra = (parts - parts_base) / 0.5
    if demi_parts_extra > 0:
        ir_base = impot_sur_quotient(rni / parts_base) * parts_base
        ir_plafonne = ir_base - C.plafond_demi_part() * demi_parts_extra
        # On retient l'impôt le PLUS ÉLEVÉ : le plafonnement borne l'avantage,
        # il ne peut pas alléger l'impôt au-delà du calcul réel.
        ir_apres_plaf = max(ir_reel, ir_plafonne)
    else:
        ir_apres_plaf = ir_reel

    # Étape 5 — décote.
    montant_decote, taux_decote = C.decote(en_couple)
    reduction = max(0.0, montant_decote - taux_decote * ir_apres_plaf)
    reduction = min(reduction, ir_apres_plaf)  # la décote n'engendre pas de crédit
    ir_net = max(0.0, ir_apres_plaf - reduction)

    return DetailIR(
        revenu_net_imposable=rni,
        parts=parts,
        impot_avant_plafonnement=ir_reel,
        impot_apres_plafonnement=ir_apres_plaf,
        plafonnement_applique=bool(demi_parts_extra > 0 and ir_apres_plaf != ir_reel),
        decote=reduction,
        impot_net=ir_net,
    )


# --- Étape 6 — part d'IR imputable à l'activité -----------------------------
def ir_impute_micro(
    base_imposable: float, foyer: ContexteFoyer
) -> Tuple[Optional[float], Optional[DetailIR], Optional[DetailIR]]:
    """IR causé par l'activité micro, par différence avec et sans elle.

    Renvoie `(None, None, None)` si le contexte du foyer est incomplet : le
    barème est progressif, un même revenu micro ne produit pas le même impôt
    selon les autres revenus et le nombre de parts.
    """
    if foyer.parts is None or foyer.autres_revenus is None:
        return None, None, None

    avec = impot_du_foyer(foyer.autres_revenus + base_imposable, foyer.parts, foyer.en_couple)
    sans = impot_du_foyer(foyer.autres_revenus, foyer.parts, foyer.en_couple)
    return max(0.0, avec.impot_net - sans.impot_net), avec, sans


# --- Étape 7 — versement libératoire ----------------------------------------
def eligibilite_versement_liberatoire(foyer: ContexteFoyer) -> ResultatVersementLiberatoire:
    """Éligibilité à l'option, selon le RFR de N-2 rapporté aux parts."""
    if foyer.rfr_n2 is None or foyer.parts is None:
        return ResultatVersementLiberatoire(
            eligible=None,
            motif_ineligibilite="RFR de l'année N-2 ou nombre de parts non fourni.",
        )
    plafond = C.rfr_maximum_par_part() * foyer.parts
    eligible = foyer.rfr_n2 <= plafond
    return ResultatVersementLiberatoire(
        eligible=eligible,
        plafond_rfr=plafond,
        motif_ineligibilite=(
            None if eligible else f"RFR N-2 ({foyer.rfr_n2:.0f} €) supérieur au plafond."
        ),
    )


def montant_versement_liberatoire(activites: List[ActiviteCA]) -> float:
    """Prélèvement forfaitaire, assis sur le CA brut sans abattement."""
    return sum(a.ca * C.taux_versement_liberatoire(a.categorie) for a in activites)


# --- Étapes 8 et 9 — cotisations et CFP -------------------------------------
def cotisations_sociales(
    activites: List[ActiviteCA], caisse: CaisseBNC, acre_active: bool
) -> float:
    """Cotisations sur le CA PLEIN : l'abattement fiscal ne réduit pas l'assiette sociale."""
    total = sum(a.ca * C.taux_social(a.categorie, caisse) for a in activites)
    if acre_active:
        total *= float(C.acre()["reduction"])
    return total


def contribution_formation(activites: List[ActiviteCA], caisse: CaisseBNC) -> float:
    return sum(a.ca * C.taux_cfp(a.categorie, caisse) for a in activites)


# --- Étape 3 (§3 du document) — prorata de première année -------------------
def plafond_applicable(categorie: CategorieFiscale, jours_activite: Optional[int]) -> Tuple[float, bool]:
    """Plafond de CA, proratisé si l'activité a démarré en cours d'année."""
    plafond = C.plafond_ca(categorie)
    if jours_activite is None or jours_activite >= _JOURS_ANNEE:
        return plafond, False
    return plafond * jours_activite / _JOURS_ANNEE, True


def controler_plafonds(
    activites: List[ActiviteCA], jours_activite: Optional[int]
) -> List[DepassementPlafond]:
    """Dépassements constatés. Un dépassement N'EST PAS une sortie du régime :
    celle-ci suppose deux années consécutives, ce que ce moteur ne sait pas."""
    depassements: List[DepassementPlafond] = []
    for activite in activites:
        plafond, proratise = plafond_applicable(activite.categorie, jours_activite)
        if activite.ca > plafond:
            depassements.append(
                DepassementPlafond(
                    categorie=activite.categorie,
                    ca=activite.ca,
                    plafond=plafond,
                    plafond_proratise=proratise,
                )
            )
    return depassements


# --- Étapes 10 et 11 — synthèse ---------------------------------------------
def simuler(demande: DemandeSimulation) -> ResultatSimulation:
    """Calcul complet. Chaque champ non calculable reste à `None`, jamais deviné."""
    activites = demande.activites
    ca_total = sum(a.ca for a in activites)
    mixte = len({a.categorie for a in activites}) > 1

    lignes = calculer_lignes(activites, mixte)
    base = sum(ligne.base_imposable for ligne in lignes)

    ir_micro, detail_avec, detail_sans = ir_impute_micro(base, demande.foyer)
    vl = eligibilite_versement_liberatoire(demande.foyer)
    if vl.eligible:
        vl.montant = montant_versement_liberatoire(activites)

    cotisations = cotisations_sociales(activites, demande.caisse_bnc, demande.acre_active)
    cfp = contribution_formation(activites, demande.caisse_bnc)

    avertissements: List[str] = []
    if demande.acre_active:
        avertissements.append(
            f"ACRE : {C.acre()['approximation']} — l'allègement réel est légèrement inférieur."
        )
    if demande.foyer.en_couple:
        avertissements.append(
            "Décote « couple » donnée comme approximative par la source ; à recouper avant usage déclaratif."
        )
    if not C.provenance()["impot_revenu"]["verifie"]:
        avertissements.append(
            "Barème, quotient familial, décote et CFP non encore recoupés avec la source officielle."
        )

    # Étape 11 — l'option retenue est la moins coûteuse parmi celles ouvertes.
    ir_retenu: Optional[float] = None
    option: Optional[str] = None
    recommandation: Optional[str] = None

    if vl.eligible and vl.montant is not None and ir_micro is not None:
        moins_cher_vl = vl.montant < ir_micro
        recommandation = "versement_liberatoire" if moins_cher_vl else "bareme"
        option = "versement_liberatoire" if demande.option_versement_liberatoire else "bareme"
        ir_retenu = vl.montant if demande.option_versement_liberatoire else ir_micro
    elif demande.option_versement_liberatoire and vl.montant is not None:
        # Option déclarée sans que l'éligibilité soit vérifiable : on calcule,
        # on ne recommande pas.
        option, ir_retenu = "versement_liberatoire", vl.montant
    elif ir_micro is not None:
        option, ir_retenu = "bareme", ir_micro

    if ir_micro is None:
        avertissements.append(
            "IR au barème non calculable sans le nombre de parts et les autres revenus du foyer."
        )

    total = revenu_net = taux_effectif = None
    if ir_retenu is not None:
        total = ir_retenu + cotisations + cfp
        revenu_net = ca_total - total
        taux_effectif = (total / ca_total) if ca_total > 0 else None

    return ResultatSimulation(
        ca_total=ca_total,
        lignes=lignes,
        base_imposable=base,
        ir_bareme=ir_micro,
        ir_bareme_calculable=ir_micro is not None,
        detail_avec_micro=detail_avec,
        detail_sans_micro=detail_sans,
        versement_liberatoire=vl,
        cotisations_sociales=cotisations,
        cfp=cfp,
        acre_appliquee=demande.acre_active,
        ir_retenu=ir_retenu,
        option_retenue=option,
        recommandation=recommandation,
        total_prelevements=total,
        revenu_net_estime=revenu_net,
        taux_effectif=taux_effectif,
        depassements=controler_plafonds(activites, demande.jours_activite),
        avertissements=avertissements,
        provenance=C.provenance(),
    )
