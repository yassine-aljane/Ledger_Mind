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
    """Factures de la période AYANT une existence fiscale.

    `lister_emises` et non `lister` : un brouillon ne porte ni numéro ni date
    d'émission, et une facture annulée par avoir a été neutralisée. Les compter
    gonflerait le CA du rapport et, par ricochet, la position face au seuil.
    """
    return facture_store.lister_emises(uid, depuis=debut.isoformat(), jusqua=fin.isoformat())


def cadeaux_periode(uid: str, debut: date, fin: date) -> list[dict]:
    """Cadeaux en nature déclarés sur la période, lus depuis l'espace Justificatifs.

    Jamais bloquant : l'indisponibilité de Mongo ne doit pas empêcher la production
    d'un rapport qui reste juste sur la partie facturée. On renvoie alors une liste
    vide, et l'absence d'avantages se lit comme telle dans le rapport.
    """
    try:
        from app.services.capture_runtime import get_runtime

        db = get_runtime()["deps"].db
        docs = db.list_cadeaux(uid)
    except Exception:  # noqa: BLE001 — dépendance externe, jamais fatale ici
        return []

    debut_iso, fin_iso = debut.isoformat(), fin.isoformat()
    retenus: list[dict] = []
    for d in docs:
        c = d.get("cadeau") or {}
        recu = c.get("date_reception")
        # Sans date, impossible de rattacher le cadeau à un exercice : on l'écarte
        # plutôt que de le compter dans une période au hasard.
        if not recu or not (debut_iso <= recu <= fin_iso):
            continue
        retenus.append(c)
    return retenus


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

    profil_partage = conversation_store.get_profil(uid)

    # Avantages en nature : désormais consolidés depuis les cadeaux RÉELLEMENT déclarés
    # (datés, valorisés, confirmés par l'utilisateur) plutôt que depuis l'estimation
    # unique du profil. Celle-ci ne subsiste qu'en repli, pour les dossiers antérieurs
    # à la déclaration pièce par pièce.
    cadeaux = cadeaux_periode(uid, debut, fin)
    if cadeaux:
        # `valeur_eur` d'abord : la déclaration se fait en euros, et un cadeau valorisé
        # en devise étrangère ne doit pas entrer au bilan à sa valeur faciale.
        avantages_nature = round(
            sum(float(c.get("valeur_eur") or c.get("valeur_ttc") or 0.0) for c in cadeaux), 2
        )
        source_avantages = "cadeaux déclarés"
    else:
        avantages_nature = profil_partage.get("remuneration_nature")
        source_avantages = "profil déclaré" if avantages_nature else None

    return {
        "nb_factures": len(factures),
        "total_ht": round(total_ht, 2),
        "total_ttc": round(total_ttc, 2),
        "ht_prestations": round(ht_prestations, 2),
        "ht_ventes": round(ht_ventes, 2),
        "avantages_nature": avantages_nature,
        "nb_cadeaux": len(cadeaux),
        "source_avantages": source_avantages,
        # Base de recettes au sens fiscal : un avantage en nature est un revenu, il
        # entre au livre des recettes comme un encaissement. C'est donc CE total, et
        # non le seul CA facturé, qui situe l'utilisateur face au plafond de son régime.
        "recettes_totales": round(total_ht + (avantages_nature or 0.0), 2),
        "profil_partage": profil_partage,
    }


def analyse_seuils(brut: dict) -> dict:
    """Position vis-à-vis des seuils + cotisations estimées, via le moteur déterministe existant.

    Le profil synthétique ne sert qu'à faire fonctionner `analyser()` avec le CA de la période ;
    aucune valeur n'y est inventée, uniquement les chiffres déjà consolidés depuis les factures.

    La base retenue est `recettes_totales` — CA facturé PLUS avantages en nature — et non le
    seul CA facturé : un cadeau de marque est une recette imposable, l'ignorer sous-estimerait
    à la fois la position face au plafond et les cotisations dues.
    """
    recettes = brut.get("recettes_totales", brut["total_ht"])
    profil_synthetique = {
        "ca_estime_annuel": recettes,
        "ca_prestations": brut["ht_prestations"],
        "ca_vente": brut["ht_ventes"],
        "type_activite": "mixte" if (brut["ht_prestations"] > 0 and brut["ht_ventes"] > 0) else (
            "vente" if brut["ht_ventes"] > 0 else "prestation"
        ),
    }
    analyse = AJ.analyser(profil_synthetique)
    taux, libelle_taux, source_taux = C.taux_social(analyse.categorie, profil_synthetique)
    cotisations = round(recettes * taux, 2)

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
