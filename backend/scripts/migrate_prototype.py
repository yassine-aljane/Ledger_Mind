"""Reprend les données du prototype (ChromaDB + SQLite) dans la MongoDB du projet.

Deux migrations indépendantes, activables séparément :

  • --corpus         ChromaDB `corpus_fiscal_fr` → collection `corpus_chunks`
  • --conversations  SQLite (sessions/messages/profil/roadmap) → collections `guidance_*`

Usage (depuis la racine du dépôt, venv actif) :

    python -m backend.scripts.migrate_prototype --corpus --conversations --source frontend/data

POURQUOI LES VECTEURS SONT RECALCULÉS, PAS COPIÉS
Le prototype vectorisait avec `intfloat/multilingual-e5-large` (1024 dimensions) ; ce projet
utilise `gemini-embedding-001` (3072). Deux modèles différents produisent des espaces vectoriels
sans rapport : un vecteur e5 rangé à côté de vecteurs Gemini ne serait jamais retrouvé, et
`_cosinus` renvoie 0.0 quand les longueurs diffèrent — le chunk existerait en base sans jamais
remonter dans une recherche. On récupère donc le TEXTE et les MÉTADONNÉES (source, autorité,
dates, public concerné), et on ré-embedde avec le modèle du projet.

Le script est idempotent : un chunk dont le texte est déjà présent n'est ni ré-embeddé ni
réinséré, et les conversations sont réécrites à l'identique si on relance.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import conversation_store as store  # noqa: E402
from app.core.mongo import get_db  # noqa: E402
from app.rag import vectorstore  # noqa: E402
from app.rag.embeddings import embed  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# Lots d'embedding : la reprise sur quota est gérée dans app.rag.embeddings.
_LOT = 32


# --------------------------------------------------------------------------------- Corpus
def _lire_chroma(chroma_db: Path) -> list[dict]:
    """Extrait (texte, métadonnées) de la base ChromaDB du prototype.

    Chroma stocke le texte et chaque métadonnée comme des lignes de `embedding_metadata`,
    typées par colonne (`string_value`, `int_value`, `float_value`). On recompose un document
    par `id` d'embedding.
    """
    connexion = sqlite3.connect(str(chroma_db))
    connexion.text_factory = str

    documents: dict[int, dict] = {}
    requete = """
        SELECT id, key, string_value, int_value, float_value
        FROM embedding_metadata
    """
    for eid, cle, valeur_txt, valeur_int, valeur_flt in connexion.execute(requete):
        doc = documents.setdefault(eid, {})
        valeur = valeur_txt if valeur_txt is not None else (
            valeur_int if valeur_int is not None else valeur_flt
        )
        if cle == "chroma:document":
            doc["texte"] = valeur
        else:
            doc[cle] = valeur
    connexion.close()

    return [d for d in documents.values() if (d.get("texte") or "").strip()]


async def migrer_corpus(source: Path) -> int:
    chroma_db = source / "chroma" / "chroma.sqlite3"
    if not chroma_db.exists():
        print(f"[!!] ChromaDB introuvable : {chroma_db}")
        return 0

    documents = _lire_chroma(chroma_db)
    print(f"ChromaDB : {len(documents)} chunks lisibles.")

    # Idempotence : on ne réimporte pas un texte déjà présent dans le corpus Mongo.
    existants = {
        (d.get("texte") or "").strip()
        for d in vectorstore.collection().find({}, {"texte": 1, "_id": 0})
    }
    nouveaux = [d for d in documents if (d.get("texte") or "").strip() not in existants]
    print(f"Déjà présents : {len(documents) - len(nouveaux)} — à importer : {len(nouveaux)}")
    if not nouveaux:
        return 0

    total = 0
    for debut in range(0, len(nouveaux), _LOT):
        lot = nouveaux[debut : debut + _LOT]
        textes = [d["texte"] for d in lot]
        try:
            vecteurs = await embed(textes)
        except Exception as exc:  # noqa: BLE001 — un lot perdu ne doit pas tout arrêter
            print(f"  [!!] lot {debut // _LOT + 1} — embedding impossible : {exc}")
            continue

        ids, metas = [], []
        for doc in lot:
            # Identifiant stable dérivé du texte : rejouer le script ne duplique rien.
            ids.append("proto_" + hashlib.sha1(doc["texte"].encode("utf-8")).hexdigest()[:16])
            metas.append({
                "source": doc.get("source") or "prototype",
                "titre": doc.get("titre") or "",
                "url": doc.get("url") or "",
                "type_doc": doc.get("type_doc") or "doctrine",
                "autorite": int(doc.get("autorite") or 3),
                "date_publication": doc.get("date_publication") or "",
                "date_effet": doc.get("date_effet") or "",
                "date_verification": doc.get("date_verification") or "",
                "concerne": doc.get("concerne") or "tous",
            })

        vectorstore.upsert(ids, vecteurs, textes, metas)
        total += len(lot)
        print(f"  [ok] {total}/{len(nouveaux)} chunks importés")

    print(f"\nCorpus : {total} chunks repris du prototype (ré-embeddés en {len(vecteurs[0])} dim).")
    return total


# -------------------------------------------------------------------------- Conversations
def _date(valeur) -> datetime:
    """Les dates SQLite sont des chaînes ISO ; Mongo veut des datetime timezone-aware."""
    if isinstance(valeur, datetime):
        return valeur
    try:
        moment = datetime.fromisoformat(str(valeur))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _colonnes(connexion: sqlite3.Connection, table: str) -> set[str]:
    return {ligne[1] for ligne in connexion.execute(f'PRAGMA table_info("{table}")')}


def _tables(connexion: sqlite3.Connection) -> set[str]:
    return {r[0] for r in connexion.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def migrer_conversations(fichier: Path, uid_defaut: str) -> dict:
    """Reprend une base SQLite du prototype. La structure Mongo cible est inchangée.

    Deux schémas existent : la v2 porte `uid`/`type` sur les sessions et un profil PAR
    UTILISATEUR — c'est exactement le modèle Mongo. La v1 n'a ni `uid` ni `type`, et son profil
    est attaché à la session ; on lui applique l'identité par défaut et le type `guidance`.
    """
    connexion = sqlite3.connect(str(fichier))
    connexion.text_factory = str
    tables = _tables(connexion)
    colonnes_sessions = _colonnes(connexion, "sessions") if "sessions" in tables else set()
    v2 = "uid" in colonnes_sessions

    bilan = {"conversations": 0, "messages": 0, "profils": 0, "roadmaps": 0}
    db = get_db()

    # --- Conversations
    if "sessions" in tables:
        champs = "id, uid, type, title, created_at, updated_at" if v2 else \
                 "id, created_at, updated_at"
        for ligne in connexion.execute(f"SELECT {champs} FROM sessions"):
            if v2:
                sid, uid, type_, titre, cree, maj = ligne
            else:
                sid, cree, maj = ligne
                uid, type_, titre = uid_defaut, "guidance", None
            db["guidance_conversations"].update_one(
                {"id": sid},
                {"$set": {"id": sid, "uid": uid or uid_defaut, "type": type_ or "guidance",
                          "title": titre, "created_at": _date(cree), "updated_at": _date(maj)}},
                upsert=True,
            )
            bilan["conversations"] += 1

    # --- Messages (réécrits par conversation pour rester idempotent)
    if "messages" in tables:
        conversations_vues: set[str] = set()
        for sid, role, contenu, sources_json, cree in connexion.execute(
            "SELECT session_id, role, content, sources_json, created_at FROM messages "
            "ORDER BY created_at"
        ):
            if sid not in conversations_vues:
                db["guidance_messages"].delete_many({"conversation_id": sid})
                conversations_vues.add(sid)
            try:
                sources = json.loads(sources_json) if sources_json else []
            except (json.JSONDecodeError, TypeError):
                sources = []
            db["guidance_messages"].insert_one({
                "conversation_id": sid, "role": role, "content": contenu,
                "sources": sources, "created_at": _date(cree),
            })
            bilan["messages"] += 1

    # --- Profils
    if "profil" in tables:
        colonnes = _colonnes(connexion, "profil")
        champs = [c for c in store.PROFILE_FIELDS if c in colonnes]
        if "uid" in colonnes:
            selection = ", ".join(["uid", *champs, "updated_at"])
            for ligne in connexion.execute(f"SELECT {selection} FROM profil"):
                uid, *reste = ligne
                valeurs = dict(zip(champs, reste[:-1]))
                valeurs = {k: v for k, v in valeurs.items() if v is not None}
                if not valeurs:
                    continue
                db["guidance_profiles"].update_one(
                    {"uid": uid or uid_defaut},
                    {"$set": {**valeurs, "updated_at": _date(reste[-1])}},
                    upsert=True,
                )
                bilan["profils"] += 1
        else:
            # v1 : le profil était attaché à la session. Le modèle actuel le partage par
            # utilisateur — les rattacher tous à `uid_defaut` écraserait les uns par les
            # autres, donc on ne devine pas et on le signale.
            nb = connexion.execute("SELECT COUNT(*) FROM profil").fetchone()[0]
            print(f"  [i] {fichier.name} : {nb} profil(s) par session ignoré(s) — le modèle "
                  f"actuel partage le profil par utilisateur, la correspondance est ambiguë.")

    # --- Feuilles de route
    if "roadmap" in tables:
        for sid, roadmap_json, checked_json, maj in connexion.execute(
            "SELECT session_id, roadmap_json, checked_json, updated_at FROM roadmap"
        ):
            try:
                roadmap = json.loads(roadmap_json) if roadmap_json else None
                checked = json.loads(checked_json) if checked_json else {}
            except (json.JSONDecodeError, TypeError):
                continue
            db["guidance_roadmaps"].update_one(
                {"conversation_id": sid},
                {"$set": {"conversation_id": sid, "roadmap": roadmap,
                          "checked": checked, "updated_at": _date(maj)}},
                upsert=True,
            )
            bilan["roadmaps"] += 1

    connexion.close()
    return bilan


# ----------------------------------------------------------------------------------- CLI
async def main() -> None:
    parseur = argparse.ArgumentParser(description="Reprise des données du prototype dans MongoDB.")
    parseur.add_argument("--source", default="frontend/data",
                         help="dossier contenant chroma/ et les .sqlite3 (défaut : frontend/data)")
    parseur.add_argument("--corpus", action="store_true", help="importer le corpus ChromaDB")
    parseur.add_argument("--conversations", action="store_true",
                         help="importer les conversations SQLite")
    parseur.add_argument("--uid", default="demo",
                         help="identité à appliquer aux bases sans uid (défaut : demo)")
    args = parseur.parse_args()

    if not (args.corpus or args.conversations):
        parseur.error("précisez au moins --corpus ou --conversations")

    source = Path(args.source).resolve()
    if not source.exists():
        parseur.error(f"dossier introuvable : {source}")

    if args.corpus:
        print("=== Corpus (ChromaDB → MongoDB) ===")
        await migrer_corpus(source)
        print(f"Corpus total en base : {vectorstore.count()} chunks.\n")

    if args.conversations:
        print("=== Conversations (SQLite → MongoDB) ===")
        for fichier in sorted(source.glob("*.sqlite3")):
            if fichier.name == "chroma.sqlite3":
                continue
            bilan = migrer_conversations(fichier, args.uid)
            print(f"  [ok] {fichier.name} — " + ", ".join(f"{v} {k}" for k, v in bilan.items()))


if __name__ == "__main__":
    asyncio.run(main())
