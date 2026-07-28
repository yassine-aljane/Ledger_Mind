"""Tests unitaires du stockage de sessions SQLite (exécutables sans dépendance externe)."""
import tempfile
from pathlib import Path

from app.memory import store


def test_session_profil_messages_et_suppression():
    old_db = store._DB
    with tempfile.TemporaryDirectory() as dossier:
        store._DB = Path(dossier) / "sessions.sqlite3"
        session_id = store.ensure_session()
        profil = store.patch_profil(session_id, {"activite": "YouTube", "ca_estime": 36000,
                                                 "vend_produits": False})
        store.add_message(session_id, "user", "Je gagne 3 000 € par mois")

        assert profil["ca_estime"] == 36000
        assert profil["vend_produits"] is False
        assert store.history(session_id)[0]["content"] == "Je gagne 3 000 € par mois"
        assert store.delete_session(session_id) is True
        assert store.history(session_id) == []
    store._DB = old_db


if __name__ == "__main__":
    test_session_profil_messages_et_suppression()
    print("Test mémoire OK")
