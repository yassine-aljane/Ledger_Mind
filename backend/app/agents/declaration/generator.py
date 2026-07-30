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
    "montants sont calculés depuis vos factures émises, mais seul votre expert-comptable peut "
    "valider et transmettre officiellement votre déclaration."
)


def _provenance(factures: list[dict]) -> str:
    if not factures:
        return "aucune facture sur la période"
    numeros = [f["numero"] for f in factures]
    if len(numeros) <= 3:
        return f"{len(numeros)} facture(s) ({', '.join(numeros)})"
    return f"{len(numeros)} facture(s) ({', '.join(numeros[:3])}, ...)"


def _lignes_pour_categorie(
    categorie: str, factures_prestations: list[dict], factures_ventes: list[dict],
    ht_prestations: float, ht_ventes: float,
) -> list[LigneDeclaration]:
    lignes: list[LigneDeclaration] = []
    if categorie in ("bnc",) and ht_prestations > 0:
        lignes.append(LigneDeclaration(
            case="5HQ", libelle="Recettes micro-BNC (prestations libérales)",
            montant=ht_prestations, provenance=_provenance(factures_prestations),
            factures_ids=[f["id"] for f in factures_prestations],
        ))
    elif categorie == "bic_services" and ht_prestations > 0:
        lignes.append(LigneDeclaration(
            case="5KP", libelle="Chiffre d'affaires micro-BIC (prestations de services)",
            montant=ht_prestations, provenance=_provenance(factures_prestations),
            factures_ids=[f["id"] for f in factures_prestations],
        ))
    elif categorie == "bic_vente" and ht_ventes > 0:
        lignes.append(LigneDeclaration(
            case="5KO", libelle="Chiffre d'affaires micro-BIC (vente de marchandises)",
            montant=ht_ventes, provenance=_provenance(factures_ventes),
            factures_ids=[f["id"] for f in factures_ventes],
        ))
    elif categorie == "mixte":
        # « mixte » dans ce moteur signifie EXACTEMENT prestations BNC + vente BIC (jamais BIC
        # services+vente) : `categorie_activite()` ne route jamais vers "bic_services" en
        # pratique, et `taux_social("mixte", ...)` applique déjà le taux BNC à la part
        # prestations. La case des prestations est donc 5HQ, pas 5KP.
        if ht_prestations > 0:
            lignes.append(LigneDeclaration(
                case="5HQ", libelle="Recettes micro-BNC (part prestations, activité mixte)",
                montant=ht_prestations, provenance=_provenance(factures_prestations),
                factures_ids=[f["id"] for f in factures_prestations],
            ))
        if ht_ventes > 0:
            lignes.append(LigneDeclaration(
                case="5KO", libelle="Chiffre d'affaires micro-BIC (part vente de marchandises)",
                montant=ht_ventes, provenance=_provenance(factures_ventes),
                factures_ids=[f["id"] for f in factures_ventes],
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
    total = round(ht_prestations + ht_ventes, 2)

    profil_synthetique = {
        "ca_estime_annuel": total,
        "ca_prestations": round(ht_prestations, 2),
        "ca_vente": round(ht_ventes, 2),
        "type_activite": "mixte" if (ht_prestations > 0 and ht_ventes > 0) else (
            "vente" if ht_ventes > 0 else "prestation"
        ),
    }
    analyse = AJ.analyser(profil_synthetique)
    taux, libelle_taux, source_taux = C.taux_social(analyse.categorie, profil_synthetique)
    cotisations = round(total * taux, 2)

    lignes = _lignes_pour_categorie(
        analyse.categorie, factures_prestations, factures_ventes,
        round(ht_prestations, 2), round(ht_ventes, 2),
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
        cotisations_urssac_estimees=cotisations,
        cotisations_urssac_taux=taux,
        cotisations_urssac_source=source_taux,
        statut="brouillon",
        revue_le=None,
        rapport_source_id=rapport_source_id,
        avertissement=_AVERTISSEMENT,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
