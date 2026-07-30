"""Consolidation déterministe de l'activité d'une période — aucun chiffre estimé par un LLM.

Réutilise le moteur juridique existant (`guidance.roadmap.analyse_juridique`, `comparateur`,
`seuils.yaml`) pour la position vis-à-vis des seuils et le taux de cotisations : rien n'est
dupliqué ni ré-estimé, ce sont EXACTEMENT les mêmes règles que celles qui produisent la feuille
de route.
"""

from __future__ import annotations

from datetime import date

from app.agents.facture import store as facture_store
from app.agents.guidance.roadmap import analyse_juridique as AJ
from app.agents.guidance.roadmap import comparateur as C
from app.core import conversation_store


def factures_periode(uid: str, debut: date, fin: date) -> list[dict]:
    return facture_store.lister(uid, depuis=debut.isoformat(), jusqua=fin.isoformat())


def consolider(uid: str, debut: date, fin: date) -> dict:
    """Chiffres bruts de la période, avant analyse juridique — tout vient des factures émises."""
    factures = factures_periode(uid, debut, fin)

    total_ht = 0.0
    total_ttc = 0.0
    ht_prestations = 0.0
    ht_ventes = 0.0
    for f in factures:
        total_ht += f["total_ht"]
        total_ttc += f["total_ttc"]
        for ligne in f["lignes"]:
            montant = ligne["quantite"] * ligne["prix_unitaire_ht"]
            if ligne.get("categorie") == "vente":
                ht_ventes += montant
            else:
                ht_prestations += montant

    # Avantages en nature : repris du profil partagé (guidance), pas recalculé par facture —
    # limite connue tant qu'une facture ne peut pas encore porter cette information elle-même.
    profil_partage = conversation_store.get_profil(uid)
    avantages_nature = profil_partage.get("remuneration_nature")

    return {
        "nb_factures": len(factures),
        "total_ht": round(total_ht, 2),
        "total_ttc": round(total_ttc, 2),
        "ht_prestations": round(ht_prestations, 2),
        "ht_ventes": round(ht_ventes, 2),
        "avantages_nature": avantages_nature,
        "profil_partage": profil_partage,
    }


def analyse_seuils(brut: dict) -> dict:
    """Position vis-à-vis des seuils + cotisations estimées, via le moteur déterministe existant.

    Le profil synthétique ne sert qu'à faire fonctionner `analyser()` avec le CA de la période ;
    aucune valeur n'y est inventée, uniquement les chiffres déjà consolidés depuis les factures.
    """
    profil_synthetique = {
        "ca_estime_annuel": brut["total_ht"],
        "ca_prestations": brut["ht_prestations"],
        "ca_vente": brut["ht_ventes"],
        "type_activite": "mixte" if (brut["ht_prestations"] > 0 and brut["ht_ventes"] > 0) else (
            "vente" if brut["ht_ventes"] > 0 else "prestation"
        ),
    }
    analyse = AJ.analyser(profil_synthetique)
    taux, libelle_taux, source_taux = C.taux_social(analyse.categorie, profil_synthetique)
    cotisations = round(brut["total_ht"] * taux, 2)

    return {
        "categorie": analyse.categorie,
        "seuil_effectif": analyse.seuil_effectif,
        "ratio_legal": analyse.ratio_legal,
        "source_legale": analyse.source_legale,
        "cotisations_estimees": cotisations,
        "cotisations_taux": taux,
        "cotisations_libelle": libelle_taux,
        "cotisations_source": source_taux,
    }
