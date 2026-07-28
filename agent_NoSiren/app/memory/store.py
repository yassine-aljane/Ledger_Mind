"""Persistance SQLite locale : sessions (par interface), messages, profil PARTAGÉ, roadmap.

Architecture (chantiers 4 & 5) :
  • sessions(id, uid, type, title, created_at, updated_at) — `type` = 'guidance' | 'pedagogue',
    l'historique est filtré par type dans chaque interface ; `uid` = identité utilisateur.
  • messages(id, session_id, role, content, sources_json, created_at)
  • profil(uid, ...champs..., updated_at) — PARTAGÉ entre les deux interfaces (clé = uid).
  • roadmap(session_id, roadmap_json, checked_json, updated_at) — état coché persisté (chantier 6).

Aucune dépendance externe : sqlite3 de la bibliothèque standard. Purge des sessions anciennes.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

_DB = Path(__file__).resolve().parents[2] / "data" / "ledgermind_v2.sqlite3"
_TTL_DAYS = 30
_DEFAULT_UID = "demo"
_PROFILE_FIELDS = ("activite", "ca_estime", "vend_produits", "recoit_cadeaux", "anciennete",
                   "situation_actuelle", "statut_actuel", "regime_actuel", "deja_immatricule",
                   "ca_prestations", "ca_vente", "remuneration_nature", "devise", "choix_parcours",
                   "ca_n_1_au_dessus_seuil")
_BOOL_FIELDS = {"vend_produits", "recoit_cadeaux", "deja_immatricule", "ca_n_1_au_dessus_seuil"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _connection() -> sqlite3.Connection:
    _DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(_DB)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, uid TEXT NOT NULL DEFAULT 'demo',
          type TEXT NOT NULL DEFAULT 'guidance', title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
          role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS profil (uid TEXT PRIMARY KEY, activite TEXT, ca_estime REAL,
          vend_produits INTEGER, recoit_cadeaux INTEGER, anciennete TEXT, situation_actuelle TEXT,
          statut_actuel TEXT, regime_actuel TEXT, deja_immatricule INTEGER,
          ca_prestations REAL, ca_vente REAL, remuneration_nature REAL, devise TEXT,
          choix_parcours TEXT, ca_n_1_au_dessus_seuil INTEGER, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS roadmap (session_id TEXT PRIMARY KEY, roadmap_json TEXT,
          checked_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    """)
    # Ajout idempotent des colonnes récentes sur une base préexistante.
    for col, typ in (("remuneration_nature", "REAL"), ("devise", "TEXT"),
                     ("ca_n_1_au_dessus_seuil", "INTEGER")):
        try:
            db.execute(f"ALTER TABLE profil ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    return db


def _normaliser(p: dict) -> dict:
    """Cohérence déterministe du profil : le CA total = prestations + ventes dès que les deux
    composantes sont connues ; la rémunération en nature ne dépasse jamais les prestations.
    (Les cadeaux ne sont PAS une catégorie de CA : leur valeur est incluse dans les prestations.)"""
    derived = {}
    presta, vente = p.get("ca_prestations"), p.get("ca_vente")
    rem = p.get("remuneration_nature")
    if presta is not None and vente is not None:
        total = presta + vente
        if p.get("ca_estime") != total:
            derived["ca_estime"] = total
    if rem is not None and presta is not None and rem > presta:
        derived["remuneration_nature"] = presta
    return derived


@contextmanager
def _database():
    """Commit puis ferme systématiquement la connexion (important sous Windows)."""
    db = _connection()
    try:
        yield db
        db.commit()
    finally:
        db.close()


def purge_expirees() -> int:
    limite = (datetime.now(UTC) - timedelta(days=_TTL_DAYS)).isoformat()
    with _database() as db:
        ids = [r["id"] for r in db.execute("SELECT id FROM sessions WHERE updated_at < ?", (limite,))]
        for table in ("messages", "roadmap", "sessions"):
            col = "id" if table == "sessions" else "session_id"
            db.executemany(f"DELETE FROM {table} WHERE {col} = ?", [(i,) for i in ids])
    return len(ids)


# --------------------------------------------------------------------------- Sessions
def ensure_session(session_id: str | None = None, uid: str = _DEFAULT_UID, type: str = "guidance") -> str:
    purge_expirees()
    sid = session_id or str(uuid.uuid4())
    uid = uid or _DEFAULT_UID
    now = _now()
    with _database() as db:
        row = db.execute("SELECT id FROM sessions WHERE id = ?", (sid,)).fetchone()
        if row:
            db.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, sid))
        else:
            db.execute("INSERT INTO sessions (id, uid, type, title, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                       (sid, uid, type, None, now, now))
            db.execute("INSERT OR IGNORE INTO profil (uid, updated_at) VALUES (?, ?)", (uid, now))
    return sid


def session_meta(session_id: str) -> dict | None:
    with _database() as db:
        row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def _uid_of(db: sqlite3.Connection, session_id: str) -> str:
    row = db.execute("SELECT uid FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return row["uid"] if row else _DEFAULT_UID


def rename_session(session_id: str, title: str) -> bool:
    with _database() as db:
        cur = db.execute("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                         (title.strip()[:120], _now(), session_id))
        return cur.rowcount > 0


def list_sessions(uid: str = _DEFAULT_UID, type: str | None = None) -> list[dict]:
    """Conversations d'un utilisateur (filtrées par type), la plus récente en premier."""
    sql = "SELECT id, type, title, created_at, updated_at FROM sessions WHERE uid = ?"
    params: list = [uid or _DEFAULT_UID]
    if type:
        sql += " AND type = ?"
        params.append(type)
    sql += " ORDER BY updated_at DESC"
    out = []
    with _database() as db:
        rows = db.execute(sql, params).fetchall()
        for r in rows:
            first = db.execute(
                "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id LIMIT 1",
                (r["id"],)).fetchone()
            apercu = (first["content"] if first else "").strip().replace("\n", " ")
            titre = r["title"] or (" ".join(apercu.split()[:6]) if apercu else "Nouvelle conversation")
            out.append({"id": r["id"], "type": r["type"], "title": titre,
                        "apercu": apercu[:90], "date": r["updated_at"]})
    return out


# --------------------------------------------------------------------------- Profil (par uid)
def _row_to_profil(row: sqlite3.Row | None) -> dict:
    if not row:
        return {}
    return {k: (bool(row[k]) if k in _BOOL_FIELDS and row[k] is not None else row[k])
            for k in _PROFILE_FIELDS if row[k] is not None}


def get_profil(uid: str = _DEFAULT_UID) -> dict:
    with _database() as db:
        row = db.execute("SELECT * FROM profil WHERE uid = ?", (uid or _DEFAULT_UID,)).fetchone()
    return _row_to_profil(row)


def get_profil_by_session(session_id: str) -> dict:
    with _database() as db:
        uid = _uid_of(db, session_id)
        row = db.execute("SELECT * FROM profil WHERE uid = ?", (uid,)).fetchone()
    return _row_to_profil(row)


def patch_profil(uid: str, valeurs: dict) -> dict:
    uid = uid or _DEFAULT_UID
    valeurs = {k: v for k, v in valeurs.items() if k in _PROFILE_FIELDS and v is not None}
    with _database() as db:
        db.execute("INSERT OR IGNORE INTO profil (uid, updated_at) VALUES (?, ?)", (uid, _now()))
        if valeurs:
            fields = list(valeurs)
            params = [int(v) if isinstance(v, bool) else v for v in valeurs.values()] + [_now(), uid]
            db.execute(f"UPDATE profil SET {', '.join(f'{k} = ?' for k in fields)}, updated_at = ? WHERE uid = ?", params)
        row = db.execute("SELECT * FROM profil WHERE uid = ?", (uid,)).fetchone()
        # Cohérence déterministe (CA total = prestations + ventes, etc.).
        derived = _normaliser(_row_to_profil(row))
        if derived:
            fields = list(derived)
            params = list(derived.values()) + [_now(), uid]
            db.execute(f"UPDATE profil SET {', '.join(f'{k} = ?' for k in fields)}, updated_at = ? WHERE uid = ?", params)
            row = db.execute("SELECT * FROM profil WHERE uid = ?", (uid,)).fetchone()
    return _row_to_profil(row)


def clear_profil_field(uid: str, field: str) -> dict:
    """Efface un champ (le remet à NULL) — pour l'effacement manuel côté panneau profil."""
    uid = uid or _DEFAULT_UID
    if field in _PROFILE_FIELDS:
        with _database() as db:
            db.execute(f"UPDATE profil SET {field} = NULL, updated_at = ? WHERE uid = ?", (_now(), uid))
    return get_profil(uid)


# --------------------------------------------------------------------------- Messages
def add_message(session_id: str, role: str, content: str, sources: list | None = None) -> None:
    with _database() as db:
        db.execute("INSERT INTO messages (session_id, role, content, sources_json, created_at) VALUES (?,?,?,?,?)",
                   (session_id, role, content, json.dumps(sources or [], ensure_ascii=False), _now()))
        db.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (_now(), session_id))
        # Titre auto depuis le premier message utilisateur (aucun appel LLM).
        if role == "user":
            row = db.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if row and not row["title"]:
                titre = " ".join(content.strip().split()[:6])[:120]
                db.execute("UPDATE sessions SET title = ? WHERE id = ?", (titre, session_id))


def history(session_id: str, limit: int | None = None) -> list[dict]:
    sql = "SELECT role, content, sources_json, created_at FROM messages WHERE session_id = ? ORDER BY id"
    with _database() as db:
        rows = db.execute(sql, (session_id,)).fetchall()
    out = [{"role": r["role"], "content": r["content"], "sources": json.loads(r["sources_json"]),
            "created_at": r["created_at"]} for r in rows]
    return out[-limit:] if limit else out


def delete_session(session_id: str) -> bool:
    with _database() as db:
        exists = db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            return False
        for table in ("messages", "roadmap"):
            db.execute(f"DELETE FROM {table} WHERE session_id = ?", (session_id,))
        db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return True


# --------------------------------------------------------------------------- Roadmap (chantier 6)
def save_roadmap(session_id: str, roadmap: dict | None = None, checked: dict | None = None) -> None:
    """Persiste la roadmap générée et/ou l'état coché, côté serveur, avec la conversation."""
    with _database() as db:
        row = db.execute("SELECT roadmap_json, checked_json FROM roadmap WHERE session_id = ?", (session_id,)).fetchone()
        rj = json.dumps(roadmap, ensure_ascii=False) if roadmap is not None else (row["roadmap_json"] if row else None)
        cj = json.dumps(checked, ensure_ascii=False) if checked is not None else (row["checked_json"] if row else "{}")
        db.execute("INSERT INTO roadmap (session_id, roadmap_json, checked_json, updated_at) VALUES (?,?,?,?) "
                   "ON CONFLICT(session_id) DO UPDATE SET roadmap_json=excluded.roadmap_json, "
                   "checked_json=excluded.checked_json, updated_at=excluded.updated_at",
                   (session_id, rj, cj, _now()))


def get_roadmap(session_id: str) -> dict | None:
    with _database() as db:
        row = db.execute("SELECT roadmap_json, checked_json FROM roadmap WHERE session_id = ?", (session_id,)).fetchone()
    if not row:
        return None
    return {"roadmap": json.loads(row["roadmap_json"]) if row["roadmap_json"] else None,
            "checked": json.loads(row["checked_json"] or "{}")}
