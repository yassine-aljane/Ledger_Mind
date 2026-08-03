"""Consultation d'un document capturé : pièce d'origine + fiche d'extraction.

Couvre ce que l'intégration doit préserver :
  • la pièce d'origine ne s'affiche `inline` que pour des types sûrs — un .html
    ou .svg déposé serait exécuté sur l'origine de l'API (XSS) ;
  • l'extension prend le relais quand le navigateur n'a pas déclaré de type ;
  • conserver l'original est facultatif : son échec ne doit pas empêcher
    l'enregistrement de la facture, seule donnée réellement produite ;
  • le document sauvegardé porte de quoi le retrouver et l'afficher
    (`document_type`, `filename`, `mime`, `has_file`).

`mongomock` ne fournit pas GridFS : ces tests exercent donc précisément le
chemin dégradé. L'aller-retour réel sur GridFS relève de MongoDB lui-même.
"""

from __future__ import annotations

import base64

import mongomock

from app.agents.capture.app.db import Database
from app.agents.capture.app.nodes import Deps, save_to_db_node, save_virement_node
from app.api.capture import _serve_mime


class _MistralInutilise:
    """Les nœuds de sauvegarde n'appellent pas le LLM."""


def _deps() -> Deps:
    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    return Deps(mistral=_MistralInutilise(), db=db)


def _etat(**extra):
    base = {
        "user_id": "u1",
        "document_id": "doc-1",
        "filename": "facture.pdf",
        "mime": "application/pdf",
        "file_b64": base64.b64encode(b"%PDF-1.4 contenu").decode("ascii"),
        "invoice": {"invoice_number": "F-001", "total_ttc": 120.0, "issue_date": "2026-02-12"},
        "analysis": "Dépense de service.",
        "expense_category": "services",
    }
    base.update(extra)
    return base


# -- Types servis ------------------------------------------------------------
def test_types_surs_affiches_inline():
    assert _serve_mime("application/pdf", "f.pdf") == "application/pdf"
    assert _serve_mime("image/png", "f.png") == "image/png"
    assert _serve_mime("image/jpeg", "photo.jpg") == "image/jpeg"


def test_types_dangereux_jamais_inline():
    # Rendus en téléchargement neutre : `None` fait basculer sur octet-stream.
    assert _serve_mime("text/html", "piege.html") is None
    assert _serve_mime("image/svg+xml", "piege.svg") is None
    assert _serve_mime("application/javascript", "piege.js") is None


def test_extension_supplee_le_type_absent():
    assert _serve_mime(None, "facture.pdf") == "application/pdf"
    assert _serve_mime("application/octet-stream", "scan.PNG") == "image/png"
    assert _serve_mime(None, "inconnu.bin") is None


def test_parametres_de_type_ignores():
    assert _serve_mime("application/pdf; charset=binary", "f.pdf") == "application/pdf"


# -- Sauvegarde : la pièce d'origine est un confort, pas un prérequis --------
def test_facture_enregistree_meme_sans_piece_conservee():
    deps = _deps()
    out = save_to_db_node(_etat(), deps)

    assert out["saved"] is True
    doc = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert doc is not None
    # GridFS absent sous mongomock : l'original n'a pas pu être conservé…
    assert doc["has_file"] is False
    # …mais l'extraction, elle, est bien là.
    assert doc["invoice"]["invoice_number"] == "F-001"
    assert doc["analysis"] == "Dépense de service."


def test_document_porte_de_quoi_etre_reaffiche():
    deps = _deps()
    save_to_db_node(_etat(), deps)

    doc = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert doc["document_type"] == "facture"
    assert doc["filename"] == "facture.pdf"
    assert doc["mime"] == "application/pdf"


def test_virement_porte_les_memes_reperes():
    deps = _deps()
    etat = _etat(
        document_id="doc-2",
        filename="virement.png",
        mime="image/png",
        virement={"transfer_reference": "VIR-9", "amount": 500.0, "execution_date": "2026-03-01"},
    )
    out = save_virement_node(etat, deps)

    assert out["saved"] is True
    doc = deps.db.get_document_by_id("u1", "doc-2")
    assert doc["document_type"] == "virement"
    assert doc["filename"] == "virement.png"
    assert doc["mime"] == "image/png"
    assert doc["has_file"] is False


def test_fichier_illisible_ne_bloque_pas_la_sauvegarde():
    deps = _deps()
    out = save_to_db_node(_etat(file_b64="pas du base64 !!"), deps)

    assert out["saved"] is True
    assert deps.db.get_invoice_by_document_id("u1", "doc-1") is not None


def test_doublon_confirme_ne_laisse_pas_de_piece_orpheline():
    deps = _deps()
    out = save_to_db_node(_etat(duplicate_decision="confirme"), deps)

    assert out["saved"] is False
    assert out["duplicate_skipped"] is True
    assert deps.db.get_original_file("u1", "doc-1") is None


# -- Suppression -------------------------------------------------------------
def test_suppression_efface_la_fiche_et_la_discussion():
    deps = _deps()
    save_to_db_node(_etat(), deps)
    deps.db.append_messages("u1", "doc-1", [{"role": "user", "content": "Combien ?"}])

    assert deps.db.delete_document("u1", "doc-1") is True
    assert deps.db.get_invoice_by_document_id("u1", "doc-1") is None
    assert deps.db.get_history("u1", "doc-1") == []


def test_suppression_d_un_virement():
    deps = _deps()
    save_virement_node(
        _etat(document_id="doc-2", virement={"transfer_reference": "VIR-9", "amount": 500.0}),
        deps,
    )

    assert deps.db.delete_document("u1", "doc-2") is True
    assert deps.db.get_document_by_id("u1", "doc-2") is None


def test_suppression_d_un_document_inconnu_ne_fait_rien():
    deps = _deps()
    assert deps.db.delete_document("u1", "jamais-vu") is False


def test_suppression_cloisonnee_par_utilisateur():
    deps = _deps()
    save_to_db_node(_etat(), deps)

    # Un autre compte ne peut pas effacer la pièce…
    assert deps.db.delete_document("intrus", "doc-1") is False
    # …et elle est toujours là pour son propriétaire.
    assert deps.db.get_invoice_by_document_id("u1", "doc-1") is not None


def test_redepot_possible_apres_suppression():
    """L'index unique de déduplication ne doit pas bloquer un document réimporté."""
    deps = _deps()
    save_to_db_node(_etat(), deps)
    deps.db.delete_document("u1", "doc-1")

    out = save_to_db_node(_etat(document_id="doc-1-bis"), deps)
    assert out["saved"] is True
    assert deps.db.get_invoice_by_document_id("u1", "doc-1-bis") is not None
