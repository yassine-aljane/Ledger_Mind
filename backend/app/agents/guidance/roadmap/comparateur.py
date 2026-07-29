"""Moteur de SCÉNARIOS et de PROJECTIONS déterministe — conséquences LÉGALES, jamais rentabilité.

Principe : l'engin COMPARE des conséquences juridiques (assiette imposable, cotisations dues,
statut de TVA, obligations, sortie de régime), il ne calcule AUCUN bénéfice, revenu net, IS ni
dividende. Il ne produit pas non plus de « profit » : le montant issu de l'abattement forfaitaire
est présenté comme une BASE IMPOSABLE estimée, pas comme un gain.

Toutes les valeurs proviennent de data/seuils.yaml. Chaque taux (cotisations micro-social,
versement libératoire, abattement) est LU dans le YAML selon la catégorie d'activité DÉTECTÉE
(BNC régime général ou Cipav, BIC services, BIC vente) — jamais une hypothèse codée en dur.

Ce qui exigerait des hypothèses absentes du YAML (rémunération du dirigeant, dividendes, IS,
revenu net) N'EST PAS calculé : la société est décrite sur ses seuls axes légaux.
"""
from __future__ import annotations

from app.agents.guidance.roadmap import seuils as S
from app.agents.guidance.roadmap._format import eur, milliers, pct
from app.agents.guidance.roadmap.analyse_juridique import (
    DURABILITE_DURABLE,
    DURABILITE_INDET,
    DURABILITE_PONCTUEL,
)
from app.agents.guidance.roadmap.models import (
    AnalyseJuridique,
    Comparatif,
    MargeSeuil,
    Projections,
    Scenario,
    ScenarioMontant,
    SortieMicro,
    StatutTVA,
)


# ---------------------------------------------------------------------------
#  Sélection des TAUX applicables — toujours lus dans seuils.yaml PAR CATÉGORIE
# ---------------------------------------------------------------------------
def _est_cipav(profil: dict) -> bool:
    """Affiliation Cipav (professions libérales réglementées) si le profil le signale."""
    return bool(profil.get("cipav")) or str(profil.get("affiliation") or "").strip().lower() == "cipav"


def taux_social(categorie: str, profil: dict) -> tuple[float, str, str]:
    """(taux micro-social, libellé, source) LU dans seuils.yaml selon la catégorie détectée.

    Catégories couvertes : BIC vente, BIC services, BNC (régime général ou Cipav), mixte
    (part limitante = prestations BNC). Aucun taux codé en dur.
    """
    social = S.bloc("micro_social")
    src = social["source"]
    if categorie == "bic_vente":
        return float(social["vente"]), "vente de marchandises (BIC)", src
    if categorie == "bic_services":
        return float(social["services_bic"]), "prestations de services (BIC)", src
    # bnc ou mixte (part prestations) : régime général sauf affiliation Cipav
    if _est_cipav(profil):
        return float(social["bnc_cipav"]), "prestations BNC (Cipav)", src
    libelle = "prestations BNC (part services)" if categorie == "mixte" else "prestations BNC (régime général)"
    return float(social["bnc_regime_general"]), libelle, src


def taux_versement_liberatoire(categorie: str) -> tuple[float, str]:
    """(taux VL, source) LU dans seuils.yaml selon la catégorie détectée."""
    vl = S.bloc("versement_liberatoire")
    if categorie == "bic_vente":
        return float(vl["vente"]), vl["source"]
    if categorie == "bic_services":
        return float(vl["services_bic"]), vl["source"]
    return float(vl["bnc"]), vl["source"]


def _abattement(categorie: str) -> tuple[float, int, str]:
    """(taux d'abattement forfaitaire, plancher, source) selon la catégorie détectée."""
    micro = S.bloc("micro")
    if categorie == "bic_vente":
        b = micro["bic_vente"]
        return float(b["abattement"]), 0, b["source"]
    if categorie == "bic_services":
        b = micro["bic_services"]
        return float(b["abattement"]), 0, b["source"]
    if categorie == "mixte":
        b = micro["bnc"]
        return float(b["abattement"]), int(micro["mixte"]["abattement_min"]), micro["mixte"]["source"]
    b = micro["bnc"]
    return float(b["abattement"]), int(b["abattement_min"]), b["source"]


def _tva_bloc(categorie: str) -> tuple[dict, dict]:
    """(bloc TVA de la catégorie, bloc TVA parent avec la source globale)."""
    tva = S.bloc("tva_franchise")
    cat = "vente" if categorie == "bic_vente" else "services"
    return tva[cat], tva


def _base_tva(analyse: AnalyseJuridique) -> float:
    """CA soumis à l'appréciation de la franchise TVA (part prestations si mixte)."""
    return analyse.ca_retenu.ca_prestations if analyse.categorie == "mixte" else analyse.ca_retenu.ca_global


# ---------------------------------------------------------------------------
#  Montants unitaires — chaque montant dérive d'un TAUX ou SEUIL sourcé
# ---------------------------------------------------------------------------
def _cotisations(analyse: AnalyseJuridique, profil: dict) -> ScenarioMontant:
    ca = analyse.ca_retenu.ca_global
    taux, libelle, source = taux_social(analyse.categorie, profil)
    montant = round(ca * taux)
    return ScenarioMontant(
        label="Cotisations sociales dues (micro-social)",
        valeur=eur(montant),
        base=f"{eur(ca)} × {pct(taux)} ({libelle})",
        source=source,
    )


def _base_imposable(analyse: AnalyseJuridique) -> ScenarioMontant:
    """Assiette imposable estimée après abattement LÉGAL forfaitaire (jamais un « bénéfice »)."""
    ca = analyse.ca_retenu.ca_global
    taux, plancher, source = _abattement(analyse.categorie)
    abattement = max(round(ca * taux), plancher) if ca > 0 else 0
    base_imposable = max(ca - abattement, 0)
    return ScenarioMontant(
        label="Base imposable estimée (après abattement forfaitaire)",
        valeur=eur(base_imposable),
        base=f"{eur(ca)} − abattement forfaitaire {int(taux * 100)} %"
             + (f" (plancher {eur(plancher)})" if plancher else ""),
        source=source,
    )


def _versement_liberatoire(analyse: AnalyseJuridique) -> ScenarioMontant:
    ca = analyse.ca_retenu.ca_global
    taux, source = taux_versement_liberatoire(analyse.categorie)
    vl = S.bloc("versement_liberatoire")
    montant = round(ca * taux)
    rfr = int(vl["rfr_max_par_part"])
    return ScenarioMontant(
        label="Versement libératoire de l'IR (option)",
        valeur=eur(montant),
        base=f"{eur(ca)} × {pct(taux)} — possible si RFR N-2 ≤ {eur(rfr)}/part",
        source=source,
    )


# ---------------------------------------------------------------------------
#  PROJECTIONS déterministes de conséquences légales
# ---------------------------------------------------------------------------
def _statut_tva(analyse: AnalyseJuridique) -> StatutTVA:
    b, tva = _tva_bloc(analyse.categorie)
    base = int(b["seuil_base"])
    maj = int(b["seuil_majore"])
    pos = _base_tva(analyse)
    if pos > maj:
        statut, lib = "redevable_majore", (
            f"Redevable de la TVA : seuil majoré ({eur(maj)}) franchi — TVA due dès le 1er jour de dépassement.")
    elif pos > base:
        statut, lib = "redevable_base", (
            f"Redevable de la TVA au 1er janvier suivant : seuil de base ({eur(base)}) franchi.")
    else:
        statut, lib = "franchise", f"En franchise en base de TVA (CA sous {eur(base)})."
    return StatutTVA(statut=statut, libelle=lib, seuil_base=base, seuil_majore=maj, source=tva["source"])


def _marges(analyse: AnalyseJuridique) -> list[MargeSeuil]:
    b, tva = _tva_bloc(analyse.categorie)
    ca = analyse.ca_retenu.ca_global
    pos_tva = _base_tva(analyse)

    def m(label: str, seuil, pos: float, src: str) -> MargeSeuil:
        seuil = int(seuil)
        return MargeSeuil(label=label, seuil=seuil, position=pos,
                          marge=round(seuil - pos, 2), depasse=pos > seuil, source=src)

    return [
        m("Plafond micro", analyse.seuil_effectif, ca, analyse.source_legale),
        m("Franchise TVA (base)", b["seuil_base"], pos_tva, tva["source"]),
        m("Franchise TVA (majoré)", b["seuil_majore"], pos_tva, tva["source"]),
    ]


def _sortie_micro(analyse: AnalyseJuridique, profil: dict) -> SortieMicro:
    """Année estimée de sortie du régime micro selon l'historique N/N-1 et, à défaut de
    dépassement actuel, une éventuelle projection de croissance (`taux_croissance`)."""
    fr = S.bloc("franchissement")
    src = fr["source"]
    annee = S.annee()
    dur = analyse.durabilite

    if dur == DURABILITE_DURABLE:
        return SortieMicro(exclusion=True, annee_estimee=annee + 1, source=src,
                           libelle=(f"Deux années consécutives de dépassement : sortie automatique "
                                    f"du régime micro au 1er janvier {annee + 1}."))
    if dur == DURABILITE_PONCTUEL:
        return SortieMicro(exclusion=False, annee_estimee=None, source=src,
                           libelle=(f"Dépassement sur une seule année : régime préservé. Un nouveau "
                                    f"dépassement en {annee + 1} entraînerait la sortie au 1er janvier "
                                    f"{annee + 2}."))
    if dur == DURABILITE_INDET:
        return SortieMicro(exclusion=False, annee_estimee=None, source=src,
                           libelle=("Sortie indéterminée : l'historique de l'an dernier (N-1) est "
                                    "nécessaire pour appliquer la règle des deux années consécutives."))

    # Stable : projection optionnelle à partir d'un taux de croissance annuel fourni.
    g = profil.get("taux_croissance")
    ca = analyse.ca_retenu.ca_global
    seuil = analyse.seuil_effectif
    if isinstance(g, (int, float)) and g > 0 and ca > 0 and seuil > 0:
        annees, projete = 0, ca
        while projete <= seuil and annees < 50:
            projete *= (1 + g)
            annees += 1
        if annees < 50:
            premiere = annee + annees          # 1re année de dépassement
            sortie = premiere + 2              # après 2 dépassements consécutifs, effet au 1er janvier suivant
            return SortieMicro(exclusion=False, annee_estimee=sortie, source=src,
                               libelle=(f"À croissance {pct(g)}/an, le plafond ({eur(seuil)}) serait "
                                        f"franchi vers {premiere} ; si le dépassement se confirme l'année "
                                        f"suivante, sortie au 1er janvier {sortie}."))
    return SortieMicro(exclusion=False, annee_estimee=None, source=src,
                       libelle="CA sous le plafond micro : aucune sortie de régime en vue.")


def _obligations_futures(analyse: AnalyseJuridique, statut: StatutTVA, sortie: SortieMicro) -> list[str]:
    cb = S.bloc("compte_bancaire_dedie")
    out: list[str] = []
    if statut.statut == "franchise":
        out.append(f"Surveiller la franchise en base de TVA (seuil de base {eur(statut.seuil_base)}).")
    else:
        out.append("Facturer, déclarer et reverser la TVA (sortie de la franchise en base).")
    if sortie.exclusion:
        out.append("Basculer vers une comptabilité réelle et un nouveau régime (sortie du micro actée).")
    elif analyse.depassement_cette_annee:
        out.append("Anticiper un possible passage en société si le dépassement se répète.")
    if analyse.ca_retenu.ca_global > int(cb["seuil"]):
        out.append(f"Ouvrir un compte bancaire dédié (CA au-dessus de {eur(cb['seuil'])} sur "
                   f"{cb['annees_consecutives']} années consécutives).")
    return out


def projections(analyse: AnalyseJuridique, profil: dict) -> Projections:
    """Projections déterministes : statut TVA, marges avant seuils, sortie de régime, obligations."""
    statut = _statut_tva(analyse)
    sortie = _sortie_micro(analyse, profil)
    return Projections(
        statut_tva=statut,
        marges=_marges(analyse),
        sortie_micro=sortie,
        obligations_futures=_obligations_futures(analyse, statut, sortie),
    )


# ---------------------------------------------------------------------------
#  Cartes de scénarios (comparaison de conséquences LÉGALES)
# ---------------------------------------------------------------------------
def _obligations_tva(analyse: AnalyseJuridique) -> str:
    b, _ = _tva_bloc(analyse.categorie)
    return (f"Franchise en base de TVA jusqu'à {eur(b['seuil_base'])} (redevable au 1er janvier "
            f"suivant), puis {eur(b['seuil_majore'])} (redevable dès le 1er jour de dépassement).")


def _scenario_micro(analyse: AnalyseJuridique, profil: dict, sortie: SortieMicro) -> Scenario:
    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    social = S.bloc("micro_social")
    vl = S.bloc("versement_liberatoire")
    cb = S.bloc("compte_bancaire_dedie")
    marge = analyse.marge_micro_euros
    faits = [
        f"CA retenu : {eur(analyse.ca_retenu.ca_global)} pour un plafond de {eur(analyse.seuil_effectif)}.",
        (f"Marge restante sous le plafond micro : {eur(marge)}." if marge >= 0
         else f"Plafond micro dépassé de {eur(-marge)} cette année."),
        sortie.libelle,
    ]
    montants = [
        _cotisations(analyse, profil),
        _base_imposable(analyse),
        _versement_liberatoire(analyse),
    ]
    obligations = [
        _obligations_tva(analyse),
        "Comptabilité allégée : livre des recettes et conservation des justificatifs.",
        f"Compte bancaire dédié obligatoire au-delà de {eur(cb['seuil'])} de CA pendant "
        f"{cb['annees_consecutives']} années consécutives.",
        "Déclaration du CA à l'URSSAF (mensuelle ou trimestrielle) et revenus sur la 2042-C-PRO.",
    ]
    return Scenario(
        id="rester_micro",
        titre="Rester en micro-entreprise",
        hypothese="Conséquences légales sur la base du CA retenu et des taux 2026 sourcés.",
        faits=faits, montants=montants, obligations=obligations,
        sources=[micro["bnc"]["source"], tva["source"], social["source"], vl["source"]],
    )


def _scenario_societe(analyse: AnalyseJuridique, sortie: SortieMicro) -> Scenario:
    """Société décrite sur ses axes LÉGAUX. Aucun net/IS/dividende chiffré (hypothèses absentes)."""
    tva = S.bloc("tva_franchise")
    faits = [
        "Aucun plafond de chiffre d'affaires : forme adaptée à une croissance durable.",
        "EURL (gérant TNS, SSI) ou SASU (président assimilé salarié, régime général) selon la "
        "protection sociale et la fiscalité (IR/IS) recherchées.",
        sortie.libelle,
    ]
    obligations = [
        "Régime réel de TVA (la franchise en base est rarement pertinente à ce niveau d'activité).",
        "Comptabilité d'engagement complète : bilan, compte de résultat, dépôt des comptes.",
        "Déclarations récurrentes : résultat (IS ou IR), TVA périodique, CFE.",
    ]
    return Scenario(
        id="passer_societe",
        titre="Passer en société (EURL / SASU)",
        hypothese="Description légale ; le revenu net dépend de choix (rémunération, dividendes) "
                  "non fournis et n'est donc pas chiffré ici.",
        faits=faits, montants=[], obligations=obligations,
        sources=[tva["source"]],
    )


def scenarios(analyse: AnalyseJuridique, profil: dict) -> list[Scenario]:
    """Scénarios comparant les conséquences légales (toujours micro + société)."""
    sortie = _sortie_micro(analyse, profil)
    return [_scenario_micro(analyse, profil, sortie), _scenario_societe(analyse, sortie)]


# ---------------------------------------------------------------------------
#  Comparatif tabulaire Micro vs Société (zone de bascule) — chiffré depuis le YAML
# ---------------------------------------------------------------------------
def comparatif(analyse: AnalyseJuridique, profil: dict) -> Comparatif:
    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    social = S.bloc("micro_social")
    fr = S.bloc("franchissement")
    b, _ = _tva_bloc(analyse.categorie)
    taux_soc, _lib, _src = taux_social(analyse.categorie, profil)
    cot = _cotisations(analyse, profil)
    return Comparatif(
        seuil_micro=analyse.seuil_effectif,
        regle_franchissement=(
            f"Un dépassement une seule année n'exclut pas du micro ; sortie seulement après "
            f"{fr['annees_consecutives']} années consécutives, effet {fr['effet']}."
        ),
        colonnes=["Critère", "Micro-entreprise", "Société (EURL/SASU)"],
        lignes=[
            ["Plafond de CA",
             f"{eur(analyse.seuil_effectif)} (tolérance {fr['annees_consecutives']} ans)",
             "Aucun plafond"],
            ["TVA",
             f"Franchise en base jusqu'à {milliers(b['seuil_base'])} € ; entre "
             f"{milliers(b['seuil_base'])} et {milliers(b['seuil_majore'])} €, redevable au 1er "
             f"janvier suivant ; au-delà ({milliers(b['seuil_majore'])} € majoré), TVA due dès le "
             "1er jour de dépassement",
             "Régime réel de TVA"],
            ["Cotisations sociales",
             f"Micro-social forfaitaire ({pct(taux_soc)} du CA) — soit {cot.valeur} sur le CA retenu",
             "Sur rémunération réelle (SSI EURL / régime général SASU)"],
            ["Comptabilité", "Livre des recettes (allégée)", "Comptabilité réelle, bilan, expert-comptable"],
            ["Complexité / coût", "Faible", "Plus élevée (formalités, comptabilité)"],
        ],
        sources=[micro["bnc"]["source"], tva["source"], social["source"]],
    )
