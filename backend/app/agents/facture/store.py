"""Persistance des factures émises — numérotation séquentielle atomique, archivage requêtable.

La numérotation « sans rupture » est une obligation légale (fiche F31808) : deux requêtes
concurrentes ne doivent jamais obtenir le même numéro, et aucun numéro ne doit être « sauté »
par un compteur non atomique. On utilise `find_one_and_update` avec `$inc`, atomique côté Mongo.

Deux séquences indépendantes et continues, une par type de document : `FA-…` pour les factures,
`AV-…` pour les avoirs. Chacune s'audite séparément.

Un BROUILLON n'a pas de numéro : la séquence n'est consommée qu'à l'émission. C'est ce qui
garantit qu'une création abandonnée ne laisse pas de trou.

Collection distincte de `invoices` (app.agents.capture) : celle-là porte les factures REÇUES
(fournisseurs) ; celle-ci porte les factures ÉMISES par l'utilisateur à ses propres clients.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import OperationFailure

from app.agents.facture import reglementaire
from app.agents.facture.schemas import Facture
from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False

_INDEX_NUMERO = "uniq_uid_numero"


def _factures():
    return get_db()["factures_emises"]


def _compteurs():
    return get_db()["factures_compteurs"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        # Index unique PARTIEL : il ne porte que sur les documents réellement numérotés.
        # Un index unique classique refuserait un second brouillon, tous ayant `numero: null`.
        try:
            _factures().create_index(
                [("uid", ASCENDING), ("numero", ASCENDING)],
                name=_INDEX_NUMERO,
                unique=True,
                partialFilterExpression={"numero": {"$type": "string"}},
            )
        except OperationFailure as exc:
            # 85/86 : un index de même clé existe avec d'autres options (version
            # antérieure, non partielle). On le remplace.
            if exc.code not in (85, 86):
                raise
            for nom, info in list(_factures().index_information().items()):
                if nom == "_id_":
                    continue
                if [(f, d) for f, d in info.get("key", [])] == [("uid", 1), ("numero", 1)]:
                    _factures().drop_index(nom)
            _factures().create_index(
                [("uid", ASCENDING), ("numero", ASCENDING)],
                name=_INDEX_NUMERO,
                unique=True,
                partialFilterExpression={"numero": {"$type": "string"}},
            )
        _factures().create_index([("uid", ASCENDING), ("date_emission", ASCENDING)])
        _factures().create_index([("uid", ASCENDING), ("statut", ASCENDING)])
        _initialized = True


def _maintenant() -> str:
    return datetime.now(timezone.utc).isoformat()


def prochain_numero(uid: str, type_document: str = "facture") -> str:
    """Réserve atomiquement le prochain numéro de séquence pour cet utilisateur.

    Format `FA-<année>-<compteur>` (ou `AV-…` pour un avoir), ex. `FA-2026-000042`.
    L'année ne remet PAS le compteur à zéro : la continuité de la séquence prime sur
    l'esthétique — casser la suite serait illégal.

    `find_one_and_update` avec `$inc` est atomique côté MongoDB : deux appels simultanés
    obtiennent nécessairement deux valeurs distinctes.
    """
    _ensure_schema()
    prefixe = reglementaire.prefixe(type_document)
    doc = _compteurs().find_one_and_update(
        {"uid": uid, "type_document": type_document},
        {"$inc": {"valeur": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    annee = datetime.now(timezone.utc).year
    return reglementaire.format_numero().format(
        prefixe=prefixe, annee=annee, compteur=doc["valeur"]
    )


def enregistrer(facture: Facture) -> None:
    """Insère ou remplace le document. Un brouillon reste librement modifiable."""
    _ensure_schema()
    _factures().replace_one(
        {"uid": facture.uid, "id": facture.id},
        facture.model_dump(mode="json"),
        upsert=True,
    )


def obtenir(uid: str, facture_id: str) -> dict | None:
    _ensure_schema()
    return _factures().find_one({"uid": uid, "id": facture_id}, {"_id": 0})


def obtenir_par_numero(uid: str, numero: str) -> dict | None:
    _ensure_schema()
    return _factures().find_one({"uid": uid, "numero": numero}, {"_id": 0})


def supprimer_brouillon(uid: str, facture_id: str) -> bool:
    """Supprime un BROUILLON. Une facture émise n'est jamais supprimée (traçabilité légale) :
    sa correction passe par un avoir."""
    _ensure_schema()
    res = _factures().delete_one(
        {"uid": uid, "id": facture_id, "statut": "brouillon"}
    )
    return res.deleted_count > 0


def _suppressions():
    """Trace des factures émises supprimées — la séquence doit rester explicable.

    Supprimer une facture émise crée un TROU dans la numérotation, que la loi interdit. Si
    l'utilisateur le fait quand même (correction d'un jeu d'essai, doublon manifeste), le
    numéro disparu doit au moins pouvoir être justifié : c'est l'objet de cette collection.
    """
    return get_db()["factures_supprimees"]


def supprimer_facture(uid: str, facture_id: str) -> dict | None:
    """Supprime une facture, quel que soit son statut, et renvoie le document supprimé.

    Réservé aux appels qui ont VÉRIFIÉ que l'utilisateur assume la conséquence : pour un
    brouillon, préférer `supprimer_brouillon`, qui ne peut rien casser.
    """
    _ensure_schema()
    document = _factures().find_one({"uid": uid, "id": facture_id}, {"_id": 0})
    if document is None:
        return None

    if document.get("statut") != "brouillon":
        # Trace posée AVANT la suppression : si l'écriture échoue, la facture reste en base
        # plutôt que de disparaître sans laisser de trace.
        _suppressions().insert_one(
            {
                "uid": uid,
                "facture_id": facture_id,
                "numero": document.get("numero"),
                "statut": document.get("statut"),
                "date_emission": document.get("date_emission"),
                "client": (document.get("client") or {}).get("nom"),
                "total_ht": document.get("total_ht"),
                "net_a_payer": document.get("net_a_payer"),
                "supprime_le": _maintenant(),
            }
        )

    _factures().delete_one({"uid": uid, "id": facture_id})
    return document


def numeros_supprimes(uid: str) -> list[dict]:
    """Numéros retirés de la séquence, pour justifier les trous lors d'un contrôle."""
    _ensure_schema()
    return list(_suppressions().find({"uid": uid}, {"_id": 0}).sort("supprime_le", ASCENDING))


def marquer(uid: str, facture_id: str, changements: dict) -> bool:
    """Applique une mise à jour ciblée (statut, règlement, référence d'avoir)."""
    _ensure_schema()
    res = _factures().update_one(
        {"uid": uid, "id": facture_id},
        {"$set": {**changements, "updated_at": _maintenant()}},
    )
    return res.matched_count > 0


def lister(
    uid: str,
    *,
    depuis: str | None = None,
    jusqua: str | None = None,
    statuts: list[str] | None = None,
) -> list[dict]:
    """Factures d'un utilisateur, filtrables par période (date d'émission ISO) et par statut.

    Réutilisé par les rapports d'activité et la déclaration fiscale (chantiers 2 et 3).
    Ces consommateurs doivent filtrer sur les statuts émis : un brouillon n'a aucune
    existence fiscale.
    """
    _ensure_schema()
    requete: dict = {"uid": uid}
    if statuts:
        requete["statut"] = {"$in": statuts}
    if depuis or jusqua:
        borne: dict = {}
        if depuis:
            borne["$gte"] = depuis
        if jusqua:
            borne["$lte"] = jusqua
        requete["date_emission"] = borne
    return list(_factures().find(requete, {"_id": 0}).sort("numero", ASCENDING))


# Statuts portant une existence fiscale : ce que l'agent de rapprochement doit compter.
STATUTS_EMIS = ["emise", "partiellement_payee", "payee"]


def lister_emises(uid: str, *, depuis: str | None = None, jusqua: str | None = None) -> list[dict]:
    """Factures ayant une existence fiscale — hors brouillons et hors annulées par avoir."""
    return lister(uid, depuis=depuis, jusqua=jusqua, statuts=STATUTS_EMIS)
