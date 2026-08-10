"""Rendu PDF d'une déclaration — le formulaire officiel, et rien d'autre.

Une déclaration tient sur UNE page : celle de l'imprimé ou du téléservice officiel, remplie
avec les montants calculés par le moteur d'impôt. C'est cette page que l'expert-comptable
reconnaît, compare et vise. Toute mise en page ajoutée par-dessus l'obligerait à retrouver
chaque rubrique au lieu de la lire à sa place habituelle.

Ce module ne dessine donc rien lui-même : il ouvre le document, installe la police, choisit le
gabarit qui convient (`templates.py`) et le laisse remplir la page. Les gabarits couvrent les
cinq déclarations, plus le cas de la déclaration sans objet — aucune ne retombe sur une
présentation libre.

Ce que la page dit d'elle-même, en toutes lettres :

  * elle n'a **pas été transmise** à l'administration ;
  * une référence de case **non recoupée** est signalée plutôt que présentée comme fiable ;
  * un numéro que l'administration seule attribue reste **à compléter**, jamais reconstitué.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.agents.facture.pdf import _LATIN1_REPL, _setup_font
from app.core import ai_act

from . import templates
from .schemas import Brouillon, JeuDeclarations

# Formulaire rempli de bout en bout par la machine. La mention visible est portée par
# `templates._MENTION_REPRODUCTION`, rendue au bas de chaque gabarit : ici on ne pose que le
# marquage lisible par machine, pour ne rien ajouter par-dessus l'imprimé officiel.
_NIVEAU_IA = "genere"


def _classe_document():
    from fpdf import FPDF

    class Document(FPDF):
        """Document sans en-tête ni pied automatiques.

        Chaque gabarit officiel porte les siens, aux emplacements de l'imprimé : un pied
        ajouté par fpdf viendrait s'y superposer.
        """

        police = "Helvetica"
        rendre_texte = staticmethod(lambda s: s)

    return Document


def brouillon_to_pdf(
    brouillon: Brouillon,
    jeu: JeuDeclarations,
    emetteur: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Rend UNE déclaration sur son formulaire officiel."""
    emetteur = emetteur or {}
    pdf = _classe_document()(format="A4", unit="mm")
    # Pas de saut de page automatique : un formulaire officiel tient sur sa page, et un
    # débordement silencieux sur une deuxième page passerait inaperçu à la relecture.
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    pdf.set_margins(8, 8, 8)
    font, unicode_ok = _setup_font(pdf)

    def texte(s: str) -> str:
        s = s or ""
        if unicode_ok:
            return s
        for k, v in _LATIN1_REPL.items():
            s = s.replace(k, v)
        return s.encode("latin-1", "replace").decode("latin-1")

    pdf.police = font
    pdf.rendre_texte = texte

    gabarit = templates.gabarit_pour(brouillon)
    gabarit(pdf, templates.rendu_pour(pdf, font, texte), jeu, brouillon, emetteur)
    ai_act.marquer_pdf(pdf, niveau=_NIVEAU_IA)
    return bytes(pdf.output())


def jeu_to_pdf(jeu: JeuDeclarations, emetteur: Optional[Dict[str, Any]] = None) -> bytes:
    """Toutes les déclarations applicables de la période, dans un seul dossier signable."""
    applicables = [b for b in jeu.brouillons if b.applicable]
    if not applicables:
        applicables = jeu.brouillons[:1]

    from pypdf import PdfReader, PdfWriter  # noqa: PLC0415 — dépendance de rendu seulement
    import io

    ecrivain = PdfWriter()
    for brouillon in applicables:
        lecteur = PdfReader(io.BytesIO(brouillon_to_pdf(brouillon, jeu, emetteur)))
        for page in lecteur.pages:
            ecrivain.add_page(page)

    # L'assemblage ne reprend que les pages : les métadonnées posées sur chaque document
    # source restent derrière. On les réécrit donc sur le dossier assemblé, sans quoi le
    # seul fichier que l'utilisateur télécharge serait le seul à ne pas porter la marque.
    meta = ai_act.metadonnees_document(_NIVEAU_IA)
    ecrivain.add_metadata({
        "/Creator": meta["creator"],
        "/Producer": meta["producer"],
        "/Keywords": meta["keywords"],
        "/Subject": meta["subject"],
    })

    sortie = io.BytesIO()
    ecrivain.write(sortie)
    return sortie.getvalue()
