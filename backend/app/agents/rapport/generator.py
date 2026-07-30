"""Assemblage du rapport d'activité — consolidation déterministe + appréciation qualitative.

Ordre imposé : d'abord les chiffres (code), puis les signaux (code), puis SEULEMENT alors le
LLM rédige l'appréciation à partir de ces chiffres déjà figés. Le LLM ne voit jamais les factures
brutes, seulement le résumé chiffré — il ne peut donc pas halluciner un montant qui n'y figure pas.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.agents.rapport import consolidation, signaux, store
from app.agents.rapport.appreciation import rediger_appreciation
from app.agents.rapport.schemas import ChiffreCle, PeriodeRequest, RapportActivite

_TITRES_REGIME = {
    "bnc": "Micro-BNC (prestations de services)",
    "bic_services": "Micro-BIC (prestations de services)",
    "bic_vente": "Micro-BIC (vente de marchandises)",
    "mixte": "Micro-entreprise, activité mixte",
}


def _regime_recommande(categorie: str) -> str:
    return _TITRES_REGIME.get(categorie, categorie)


async def generer_rapport(uid: str, requete: PeriodeRequest, objectif: str | None = None) -> RapportActivite:
    brut = consolidation.consolider(uid, requete.date_debut, requete.date_fin)
    analyse = consolidation.analyse_seuils(brut)
    ratio_pct = round(analyse["ratio_legal"] * 100, 1)

    profil = brut.pop("profil_partage", {})
    ca_declare = profil.get("ca_estime")
    signaux_detectes = signaux.detecter_signaux(brut, ca_declare)

    chiffres_cles = [
        ChiffreCle(cle="nb_factures", libelle="Factures émises",
                   valeur=str(brut["nb_factures"])),
        ChiffreCle(cle="total_ht", libelle="Total HT encaissé", valeur=f"{brut['total_ht']:.2f} €"),
        ChiffreCle(cle="total_ttc", libelle="Total TTC", valeur=f"{brut['total_ttc']:.2f} €"),
        ChiffreCle(cle="ventilation_prestations", libelle="dont prestations HT",
                   valeur=f"{brut['ht_prestations']:.2f} €"),
        ChiffreCle(cle="ventilation_ventes", libelle="dont ventes HT",
                   valeur=f"{brut['ht_ventes']:.2f} €"),
        ChiffreCle(cle="categorie", libelle="Catégorie fiscale",
                   valeur=_regime_recommande(analyse["categorie"]), source=analyse["source_legale"]),
        ChiffreCle(cle="seuil", libelle="Seuil applicable",
                   valeur=f"{analyse['seuil_effectif']:.0f} €", source=analyse["source_legale"]),
        ChiffreCle(cle="cotisations", libelle="Cotisations sociales estimées",
                   valeur=f"{analyse['cotisations_estimees']:.2f} € "
                          f"({analyse['cotisations_taux'] * 100:.1f} %, {analyse['cotisations_libelle']})",
                   source=analyse["cotisations_source"]),
    ]
    if brut["avantages_nature"]:
        chiffres_cles.append(ChiffreCle(
            cle="avantages_nature", libelle="Avantages en nature (profil)",
            valeur=f"{brut['avantages_nature']:.2f} €",
        ))

    resume = (
        f"{brut['nb_factures']} facture(s) émise(s) entre le "
        f"{requete.date_debut.strftime('%d/%m/%Y')} et le {requete.date_fin.strftime('%d/%m/%Y')}, "
        f"pour un total de {brut['total_ht']:.2f} € HT."
    )

    donnees_appreciation = {
        **brut, **analyse,
        "regime_recommande": _regime_recommande(analyse["categorie"]),
    }
    appreciation = await rediger_appreciation(
        donnees_appreciation, objectif,
        [s.model_dump() for s in signaux_detectes],
    )

    sources = sorted({analyse["source_legale"], analyse["cotisations_source"]})

    return RapportActivite(
        id=store.nouvel_id(),
        uid=uid,
        date_debut=requete.date_debut,
        date_fin=requete.date_fin,
        nb_factures=brut["nb_factures"],
        total_ht=brut["total_ht"],
        total_ttc=brut["total_ttc"],
        ventilation_prestations_ht=brut["ht_prestations"],
        ventilation_ventes_ht=brut["ht_ventes"],
        avantages_nature=brut["avantages_nature"],
        categorie_fiscale=analyse["categorie"],
        seuil_applicable=analyse["seuil_effectif"],
        position_vs_seuil_pct=ratio_pct,
        regime_recommande=_regime_recommande(analyse["categorie"]),
        cotisations_estimees=analyse["cotisations_estimees"],
        cotisations_taux=analyse["cotisations_taux"],
        cotisations_source=analyse["cotisations_source"],
        chiffres_cles=chiffres_cles,
        signaux_conformite=signaux_detectes,
        resume_narratif=resume,
        appreciation=appreciation,
        objectif_utilisateur=objectif,
        sources=sources,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
