"""Préparation de la déclaration fiscale — cases vérifiées à la source, jamais de mémoire.

Cases du formulaire 2042-C-PRO (étape 3, revenus professionnels), vérifiées le 2026-07-30 sur
https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-
activite-dauto-entrepreneur : 5HQ = micro-BNC (prestations libérales) ; 5KO = micro-BIC vente de
marchandises ; 5KP = micro-BIC prestations de services. La catégorie qui détermine la case est
EXACTEMENT celle du moteur déterministe existant (`analyse_juridique.analyser`), jamais redéduite
ici — une activité mixte déclare séparément ses deux cases, comme le rappelle déjà l'agent
pédagogique du projet (jamais « micro-entrepreneur » opposé à « régime réel » sur ce formulaire).
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.agents import cadeaux_fiscaux
from app.agents.declaration.schemas import Declaration, LigneDeclaration
from app.agents.facture import store as facture_store
from app.agents.guidance.roadmap import analyse_juridique as AJ
from app.agents.guidance.roadmap import comparateur as C
from app.agents.rapport import store as rapport_store

_SOURCE_CASES = (
    "https://www.impots.gouv.fr/particulier/questions/"
    "comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur"
)

_TITRES_REGIME = {
    "bnc": "Micro-BNC (prestations de services)",
    "bic_services": "Micro-BIC (prestations de services)",
    "bic_vente": "Micro-BIC (vente de marchandises)",
    "mixte": "Micro-entreprise, activité mixte (BNC + BIC)",
}

_AVERTISSEMENT = (
    "Document préparé pour revue et transmission par votre expert-comptable — CE N'EST PAS UNE "
    "DÉCLARATION TRANSMISE À L'ADMINISTRATION. Vérifiez chaque case avant toute signature ; les "
    "montants sont calculés depuis vos factures émises et vos avantages en nature déclarés, mais "
    "seul votre expert-comptable peut valider et transmettre officiellement votre déclaration."
)

# Les avantages en nature relèvent d'une PRESTATION : le créateur ne cède aucune marchandise,
# il est rémunéré en biens pour un service rendu. Ils rejoignent donc la case des prestations
# (5HQ en BNC, 5KP en BIC services), jamais 5KO.
_NOTE_NATURE = (
    "Le montant reporté dans cette case est le CA BRUT encaissé, avantages en nature compris "
    "et sans abattement : l'abattement forfaitaire est appliqué par l'administration à partir "
    "de ce montant brut."
)


def _provenance(factures: list[dict], cadeaux: list[cadeaux_fiscaux.CadeauRecette]) -> str:
    """Provenance d'une case : d'où vient chaque euro, facturé comme reçu en nature."""
    morceaux: list[str] = []
    if factures:
        numeros = [f["numero"] for f in factures]
        morceaux.append(
            f"{len(numeros)} facture(s) ({', '.join(numeros[:3])}"
            + (", ..." if len(numeros) > 3 else "")
            + ")"
        )
    if cadeaux:
        morceaux.append(cadeaux_fiscaux.provenance(cadeaux))
    return " + ".join(morceaux) if morceaux else "aucune pièce sur la période"


def _ligne(
    case: str, libelle: str, factures: list[dict], ht: float,
    cadeaux: list[cadeaux_fiscaux.CadeauRecette] | None = None,
) -> LigneDeclaration:
    """Une case du formulaire, facturé et nature réunis mais restés distincts."""
    cadeaux = cadeaux or []
    nature = cadeaux_fiscaux.total_eur(cadeaux)
    return LigneDeclaration(
        case=case,
        libelle=libelle,
        montant=round(ht + nature, 2),
        provenance=_provenance(factures, cadeaux),
        factures_ids=[f["id"] for f in factures],
        cadeaux_ids=[c.document_id for c in cadeaux],
        montant_facture=round(ht, 2),
        montant_nature=nature,
    )


def _lignes_pour_categorie(
    categorie: str, factures_prestations: list[dict], factures_ventes: list[dict],
    ht_prestations: float, ht_ventes: float,
    cadeaux: list[cadeaux_fiscaux.CadeauRecette],
) -> list[LigneDeclaration]:
    lignes: list[LigneDeclaration] = []
    nature = cadeaux_fiscaux.total_eur(cadeaux)
    # Une case n'est ouverte que si elle porte un montant : un avantage en nature seul,
    # sans aucune facture, suffit à ouvrir la case des prestations — c'est bien une recette.
    prestations_non_nulles = ht_prestations > 0 or nature > 0

    if categorie == "bnc" and prestations_non_nulles:
        lignes.append(_ligne(
            "5HQ", "Recettes micro-BNC (prestations libérales)",
            factures_prestations, ht_prestations, cadeaux,
        ))
    elif categorie == "bic_services" and prestations_non_nulles:
        lignes.append(_ligne(
            "5KP", "Chiffre d'affaires micro-BIC (prestations de services)",
            factures_prestations, ht_prestations, cadeaux,
        ))
    elif categorie == "bic_vente":
        if ht_ventes > 0:
            lignes.append(_ligne(
                "5KO", "Chiffre d'affaires micro-BIC (vente de marchandises)",
                factures_ventes, ht_ventes,
            ))
        # Une activité classée « vente » qui reçoit des dotations garde une part de
        # prestation : la rémunération en nature paie un service, pas une marchandise.
        # La fondre dans 5KO lui appliquerait l'abattement de 71 % au lieu de 50 %.
        if nature > 0:
            lignes.append(_ligne(
                "5KP", "Chiffre d'affaires micro-BIC (prestations rémunérées en nature)",
                [], 0.0, cadeaux,
            ))
    elif categorie == "mixte":
        # « mixte » dans ce moteur signifie EXACTEMENT prestations BNC + vente BIC (jamais BIC
        # services+vente) : `categorie_activite()` ne route jamais vers "bic_services" en
        # pratique, et `taux_social("mixte", ...)` applique déjà le taux BNC à la part
        # prestations. La case des prestations est donc 5HQ, pas 5KP.
        if prestations_non_nulles:
            lignes.append(_ligne(
                "5HQ", "Recettes micro-BNC (part prestations, activité mixte)",
                factures_prestations, ht_prestations, cadeaux,
            ))
        if ht_ventes > 0:
            lignes.append(_ligne(
                "5KO", "Chiffre d'affaires micro-BIC (part vente de marchandises)",
                factures_ventes, ht_ventes,
            ))
    return lignes


def generer_declaration(uid: str, debut: date, fin: date, rapport_source_id: str | None = None) -> Declaration:
    factures = facture_store.lister(uid, depuis=debut.isoformat(), jusqua=fin.isoformat())
    factures_prestations = [f for f in factures
                           if any(l.get("categorie") != "vente" for l in f["lignes"])]
    factures_ventes = [f for f in factures
                       if any(l.get("categorie") == "vente" for l in f["lignes"])]

    ht_prestations = sum(
        l["quantite"] * l["prix_unitaire_ht"]
        for f in factures for l in f["lignes"] if l.get("categorie") != "vente"
    )
    ht_ventes = sum(
        l["quantite"] * l["prix_unitaire_ht"]
        for f in factures for l in f["lignes"] if l.get("categorie") == "vente"
    )

    # Avantages en nature de la période. Un cadeau de marque rémunère une prestation déjà
    # rendue : c'est une recette imposable, à déclarer au même titre qu'une facture encaissée.
    # L'omettre minorerait la case, donc l'impôt — et la case attend un montant BRUT.
    collecte = cadeaux_fiscaux.collecter(uid, debut, fin)
    recettes_nature = collecte.total_eur
    ca_prestations = round(ht_prestations + recettes_nature, 2)
    total = round(ht_prestations + ht_ventes + recettes_nature, 2)

    profil_synthetique = {
        "ca_estime_annuel": total,
        # Les avantages en nature comptent comme des prestations : ils entrent dans la part
        # qui détermine la catégorie fiscale, sans quoi un créateur payé uniquement en
        # dotations serait analysé comme n'ayant aucune activité.
        "ca_prestations": ca_prestations,
        "ca_vente": round(ht_ventes, 2),
        "type_activite": "mixte" if (ca_prestations > 0 and ht_ventes > 0) else (
            "vente" if ht_ventes > 0 else "prestation"
        ),
    }
    analyse = AJ.analyser(profil_synthetique)
    taux, libelle_taux, source_taux = C.taux_social(analyse.categorie, profil_synthetique)
    cotisations = round(total * taux, 2)

    lignes = _lignes_pour_categorie(
        analyse.categorie, factures_prestations, factures_ventes,
        round(ht_prestations, 2), round(ht_ventes, 2), collecte.retenus,
    )

    return Declaration(
        id=f"{uid}_{debut.isoformat()}_{fin.isoformat()}",
        uid=uid,
        date_debut=debut,
        date_fin=fin,
        regime=_TITRES_REGIME.get(analyse.categorie, analyse.categorie),
        categorie=analyse.categorie,
        source_formulaire=_SOURCE_CASES,
        lignes=lignes,
        total_ca_declare=total,
        total_recettes_nature=recettes_nature,
        cadeaux_ecartes=(
            [f"{c.libelle} — devise non convertie en euros" for c in collecte.non_convertis]
            + [f"{c.libelle} — date de réception manquante" for c in collecte.sans_date]
        ),
        cotisations_urssac_estimees=cotisations,
        cotisations_urssac_taux=taux,
        cotisations_urssac_source=source_taux,
        statut="brouillon",
        revue_le=None,
        rapport_source_id=rapport_source_id,
        avertissement=_AVERTISSEMENT + (f" {_NOTE_NATURE}" if recettes_nature > 0 else ""),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
