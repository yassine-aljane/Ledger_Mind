"""Couche MongoDB : client, index, CRUD factures + mémoire de conversation.

Deux collections (FR-12 / FR-13) :
  - `invoices`      : facture extraite + analyse + classification.
                      Index UNIQUE sur (invoice_number, issuer_tax_id, total_ttc, issue_date).
                      Index sur user_id.
  - `chat_sessions` : historique de conversation par (user_id, document_id).

S'y ajoute un dépôt GridFS `capture_files` conservant la pièce d'origine (PDF/image)
pour pouvoir la réafficher : au-delà des 16 Mo du BSON, un document Mongo ne peut pas
porter le fichier lui-même.

Le client Mongo est injectable pour permettre les tests avec `mongomock`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, OperationFailure

logger = logging.getLogger(__name__)

# Nom de l'index unique de déduplication (référencé à l'insertion).
UNIQUE_INDEX_NAME = "uniq_invoice_dedup_key"

# Dépôt GridFS des pièces d'origine (une par document_id).
FILES_BUCKET_NAME = "capture_files"


class DuplicateInvoiceError(Exception):
    """Levée quand l'insertion viole l'index unique de déduplication (facture)."""


class DuplicateVirementError(Exception):
    """Levée quand l'insertion viole l'index unique de déduplication (virement)."""


class DuplicateContratError(Exception):
    """Levée quand l'insertion viole l'index unique de déduplication (contrat)."""


class DuplicateCadeauError(Exception):
    """Levée quand l'insertion viole l'index unique de déduplication (cadeau en nature)."""


class Database:
    def __init__(self, client: MongoClient, db_name: str):
        self._client = client
        self._db = client[db_name]
        self.invoices = self._db["invoices"]
        self.virements = self._db["virements"]      # justificatifs de virement
        self.contrats = self._db["contrats"]        # contrats et conventions signés
        self.cadeaux = self._db["cadeaux"]          # cadeaux / avantages en nature reçus
        self.chat_sessions = self._db["chat_sessions"]
        self.fx_rates = self._db["fx_rates"]        # cache de taux de change (devise, date)
        self._files_bucket: Any = None              # GridFSBucket, ouvert à la demande

    @classmethod
    def connect(cls, uri: str, db_name: str) -> "Database":
        return cls(MongoClient(uri), db_name)

    def ensure_indexes(self) -> None:
        """Crée les index requis (idempotent, auto-réparant).

        La déduplication (FR-12) est PAR UTILISATEUR : deux créateurs distincts
        peuvent légitimement recevoir une facture n° 001 du même fournisseur. La
        clé unique inclut donc `user_id`, en cohérence avec `find_duplicate` (lui
        aussi filtré par user_id). Sans cela, l'unicité serait globale et une
        facture d'un autre utilisateur bloquerait l'insertion (faux doublon).
        """
        # Index UNIQUE de déduplication (FR-12), par utilisateur.
        self._ensure_unique_index(
            self.invoices,
            [
                ("user_id", ASCENDING),
                ("invoice_number", ASCENDING),
                ("issuer_tax_id", ASCENDING),
                ("total_ttc", ASCENDING),
                ("issue_date", ASCENDING),
            ],
            name=UNIQUE_INDEX_NAME,
        )
        # Index de listing par utilisateur (FR-13).
        self._ensure_index(self.invoices, [("user_id", ASCENDING)], name="idx_user_id")
        # Virements : listing par utilisateur + déduplication par utilisateur.
        self._ensure_index(self.virements, [("user_id", ASCENDING)], name="idx_vir_user_id")
        self._ensure_unique_index(
            self.virements,
            [
                ("user_id", ASCENDING),
                ("transfer_reference", ASCENDING),
                ("amount", ASCENDING),
                ("execution_date", ASCENDING),
            ],
            name="uniq_virement_dedup_key",
        )
        # Contrats : listing par utilisateur + déduplication par utilisateur.
        self._ensure_index(self.contrats, [("user_id", ASCENDING)], name="idx_contrat_user_id")
        self._ensure_unique_index(
            self.contrats,
            [
                ("user_id", ASCENDING),
                ("reference", ASCENDING),
                ("contract_type", ASCENDING),
                ("signature_date", ASCENDING),
                ("amount", ASCENDING),
            ],
            name="uniq_contrat_dedup_key",
        )
        # Cadeaux en nature : listing par utilisateur + déduplication par utilisateur.
        self._ensure_index(self.cadeaux, [("user_id", ASCENDING)], name="idx_cadeau_user_id")
        self._ensure_unique_index(
            self.cadeaux,
            [
                ("user_id", ASCENDING),
                ("marque", ASCENDING),
                ("description", ASCENDING),
                ("date_reception", ASCENDING),
                ("valeur_ttc", ASCENDING),
            ],
            name="uniq_cadeau_dedup_key",
        )
        # Historique de chat par (user_id, document_id).
        self._ensure_unique_index(
            self.chat_sessions,
            [("user_id", ASCENDING), ("document_id", ASCENDING)],
            name="uniq_chat_session",
        )
        # Cache de taux de change par (devise, date) : évite de rappeler l'API à chaque affichage.
        self._ensure_unique_index(
            self.fx_rates,
            [("currency", ASCENDING), ("date", ASCENDING)],
            name="uniq_fx_rate",
        )

    @staticmethod
    def _ensure_index(collection, keys, name, unique: bool = False) -> None:
        """Crée un index NON unique, en tolérant qu'il préexiste (idempotent)."""
        try:
            collection.create_index(keys, name=name, unique=unique)
        except OperationFailure as exc:
            # 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict : déjà présent.
            if exc.code not in (85, 86):
                raise

    @staticmethod
    def _ensure_unique_index(collection, keys, name) -> None:
        """Garantit UNE seule contrainte d'unicité, portant exactement `keys`.

        Supprime au passage toute ancienne contrainte d'unicité de clé
        DIFFÉRENTE (typiquement l'ancien index global sans `user_id`, qui
        provoquait de faux doublons entre utilisateurs), puis (re)crée l'index
        attendu. Idempotent d'une version du schéma à l'autre.
        """
        desired = [(field, direction) for field, direction in keys]
        for idx_name, info in list(collection.index_information().items()):
            if idx_name == "_id_":
                continue
            info_key = [(f, d) for f, d in info.get("key", [])]
            if info_key == desired:
                if idx_name == name and info.get("unique"):
                    return  # déjà exactement l'index voulu
                collection.drop_index(idx_name)   # bonne clé, mauvais nom/options
            elif info.get("unique") or idx_name == name:
                collection.drop_index(idx_name)   # ancienne clé unique obsolète
        collection.create_index(keys, name=name, unique=True)

    # -- Déduplication --------------------------------------------------------
    def find_duplicate(self, user_id: str, dedup_key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Cherche une facture existante du même utilisateur avec la même clé."""
        query = {"user_id": user_id, **{k: dedup_key.get(k) for k in (
            "invoice_number", "issuer_tax_id", "total_ttc", "issue_date")}}
        return self.invoices.find_one(query)

    # -- Persistance factures -------------------------------------------------
    def insert_invoice(self, doc: Dict[str, Any]) -> str:
        """Insère une facture ; lève DuplicateInvoiceError si la clé existe déjà."""
        payload = dict(doc)
        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        try:
            res = self.invoices.insert_one(payload)
            return str(res.inserted_id)
        except DuplicateKeyError as exc:  # course entre check et insert
            raise DuplicateInvoiceError(str(exc)) from exc

    def list_invoices(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self.invoices.find({"user_id": user_id}).sort("created_at", ASCENDING)
        out: List[Dict[str, Any]] = []
        for d in cursor:
            d.pop("_id", None)
            out.append(d)
        return out

    def get_invoice_by_document_id(self, user_id: str, document_id: str) -> Optional[Dict[str, Any]]:
        d = self.invoices.find_one({"user_id": user_id, "document_id": document_id})
        if d:
            d.pop("_id", None)
        return d

    # -- Persistance virements ------------------------------------------------
    def find_duplicate_virement(self, user_id: str, dedup_key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Cherche un virement existant du même utilisateur avec la même clé."""
        query = {"user_id": user_id, **{k: dedup_key.get(k) for k in (
            "transfer_reference", "amount", "execution_date")}}
        return self.virements.find_one(query)

    def insert_virement(self, doc: Dict[str, Any]) -> str:
        payload = dict(doc)
        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        try:
            res = self.virements.insert_one(payload)
            return str(res.inserted_id)
        except DuplicateKeyError as exc:  # course entre check et insert
            raise DuplicateVirementError(str(exc)) from exc

    def list_virements(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self.virements.find({"user_id": user_id}).sort("created_at", ASCENDING)
        out: List[Dict[str, Any]] = []
        for d in cursor:
            d.pop("_id", None)
            out.append(d)
        return out

    # -- Persistance contrats -------------------------------------------------
    def find_duplicate_contrat(self, user_id: str, dedup_key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Cherche un contrat existant du même utilisateur avec la même clé."""
        query = {"user_id": user_id, **{k: dedup_key.get(k) for k in (
            "reference", "contract_type", "signature_date", "amount")}}
        return self.contrats.find_one(query)

    def insert_contrat(self, doc: Dict[str, Any]) -> str:
        payload = dict(doc)
        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        try:
            res = self.contrats.insert_one(payload)
            return str(res.inserted_id)
        except DuplicateKeyError as exc:  # course entre check et insert
            raise DuplicateContratError(str(exc)) from exc

    def list_contrats(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self.contrats.find({"user_id": user_id}).sort("created_at", ASCENDING)
        out: List[Dict[str, Any]] = []
        for d in cursor:
            d.pop("_id", None)
            out.append(d)
        return out

    # -- Persistance cadeaux en nature ---------------------------------------
    def find_duplicate_cadeau(self, user_id: str, dedup_key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Cherche un cadeau existant du même utilisateur avec la même clé."""
        query = {"user_id": user_id, **{k: dedup_key.get(k) for k in (
            "marque", "description", "date_reception", "valeur_ttc")}}
        return self.cadeaux.find_one(query)

    def insert_cadeau(self, doc: Dict[str, Any]) -> str:
        payload = dict(doc)
        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        try:
            res = self.cadeaux.insert_one(payload)
            return str(res.inserted_id)
        except DuplicateKeyError as exc:  # course entre check et insert
            raise DuplicateCadeauError(str(exc)) from exc

    def list_cadeaux(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self.cadeaux.find({"user_id": user_id}).sort("created_at", ASCENDING)
        out: List[Dict[str, Any]] = []
        for d in cursor:
            d.pop("_id", None)
            out.append(d)
        return out

    def get_document_by_id(self, user_id: str, document_id: str) -> Optional[Dict[str, Any]]:
        """Retrouve un document (facture, virement, contrat OU cadeau) pour le Q&A."""
        query = {"user_id": user_id, "document_id": document_id}
        for collection in (self.invoices, self.virements, self.contrats, self.cadeaux):
            d = collection.find_one(query)
            if d:
                d.pop("_id", None)
                return d
        return None

    # -- Cache des taux de change --------------------------------------------
    def get_cached_fx_rate(self, currency: str, date: str) -> Optional[Tuple[float, str]]:
        """Taux mémorisé et sa provenance, `None` si la paire n'a jamais été résolue."""
        doc = self.fx_rates.find_one({"currency": currency, "date": date})
        if not doc or doc.get("rate") is None:
            return None
        # Les entrées antérieures au suivi de provenance ne peuvent venir que de
        # la BCE : elle était alors la seule source consultée.
        return float(doc["rate"]), doc.get("source") or "BCE"

    def cache_fx_rate(self, currency: str, date: str, rate: float, source: str) -> None:
        self.fx_rates.update_one(
            {"currency": currency, "date": date},
            {"$set": {"rate": rate, "source": source}},
            upsert=True,
        )

    # -- Suppression ----------------------------------------------------------
    def delete_document(self, user_id: str, document_id: str) -> bool:
        """Supprime une pièce et tout ce qui s'y rattache. False si elle n'existe pas.

        Quatre traces à effacer ensemble, sous peine d'incohérences : la ligne
        métier, la pièce d'origine dans GridFS, l'historique de discussion, et
        — côté appelant — l'entrée du fil d'activité de l'utilisateur.

        Les quatre collections sont interrogées sans court-circuit : un même
        `document_id` ne devrait exister que dans une seule, mais un reliquat
        ne doit pas survivre à la suppression.
        """
        query = {"user_id": user_id, "document_id": document_id}
        supprimes = sum(
            collection.delete_one(query).deleted_count
            for collection in (self.invoices, self.virements, self.contrats, self.cadeaux)
        )

        if not supprimes:
            return False

        self.delete_original_file(user_id, document_id)
        self.chat_sessions.delete_one({"user_id": user_id, "document_id": document_id})
        return True

    # -- Pièce d'origine (GridFS) ---------------------------------------------
    def _bucket(self) -> Optional[Any]:
        """Ouvre le dépôt GridFS à la demande, `None` s'il est indisponible.

        Conserver l'original est un confort d'affichage, pas une étape du
        traitement : si GridFS manque (backend Mongo réduit, mongomock sans
        intégration), l'analyse doit continuer sans lui.
        """
        if self._files_bucket is None:
            try:
                import gridfs

                self._files_bucket = gridfs.GridFSBucket(
                    self._db, bucket_name=FILES_BUCKET_NAME
                )
            except Exception as exc:  # pragma: no cover - dépend du backend Mongo
                logger.warning("GridFS indisponible, pièces d'origine non conservées : %s", exc)
                return None
        return self._files_bucket

    def save_original_file(
        self,
        user_id: str,
        document_id: str,
        data: bytes,
        filename: Optional[str] = None,
        mime: Optional[str] = None,
    ) -> bool:
        """Conserve la pièce d'origine. Renvoie False si elle n'a pas pu l'être.

        L'échec n'est jamais propagé : une facture correctement extraite doit
        rester enregistrée même si son original n'a pas pu être conservé.
        """
        bucket = self._bucket()
        if bucket is None or not data:
            return False
        try:
            self.delete_original_file(user_id, document_id)  # ré-analyse : un seul original
            bucket.upload_from_stream(
                filename or document_id,
                data,
                metadata={"user_id": user_id, "document_id": document_id, "mime": mime},
            )
            return True
        except Exception as exc:
            logger.warning("Pièce d'origine non conservée (document %s) : %s", document_id, exc)
            return False

    def get_original_file(
        self, user_id: str, document_id: str
    ) -> Optional[Tuple[bytes, Optional[str], Optional[str]]]:
        """Relit la pièce d'origine : (contenu, nom de fichier, type MIME)."""
        bucket = self._bucket()
        if bucket is None:
            return None
        try:
            cursor = bucket.find(
                {"metadata.user_id": user_id, "metadata.document_id": document_id}
            )
            for grid_out in cursor:
                meta = grid_out.metadata or {}
                return grid_out.read(), grid_out.filename, meta.get("mime")
        except Exception as exc:
            logger.warning("Lecture GridFS impossible (document %s) : %s", document_id, exc)
        return None

    def delete_original_file(self, user_id: str, document_id: str) -> None:
        bucket = self._bucket()
        if bucket is None:
            return
        try:
            cursor = bucket.find(
                {"metadata.user_id": user_id, "metadata.document_id": document_id}
            )
            for grid_out in cursor:
                bucket.delete(grid_out._id)
        except Exception as exc:
            logger.warning("Purge GridFS impossible (document %s) : %s", document_id, exc)

    # -- Mémoire de conversation ---------------------------------------------
    def get_history(self, user_id: str, document_id: str) -> List[Dict[str, str]]:
        doc = self.chat_sessions.find_one({"user_id": user_id, "document_id": document_id})
        return list(doc.get("messages", [])) if doc else []

    def append_messages(self, user_id: str, document_id: str, messages: List[Dict[str, str]]) -> None:
        """Ajoute des messages à l'historique (crée la session si absente)."""
        self.chat_sessions.update_one(
            {"user_id": user_id, "document_id": document_id},
            {
                "$push": {"messages": {"$each": messages}},
                "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
            },
            upsert=True,
        )
