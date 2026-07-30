"""Rendu PDF du rapport d'activité — même palette et même moteur fpdf2 que facture/pdf.py.

Rien n'est composé ici : l'objet `RapportActivite` est déjà entièrement calculé.
"""

from __future__ import annotations

from app.agents.rapport.schemas import RapportActivite

NAVY = (27, 58, 95)
NAVY_BG = (237, 242, 248)
BUTTER_INK = (138, 109, 31)
BUTTER_BG = (251, 243, 220)
PLUM = (122, 74, 99)
PLUM_BG = (243, 233, 239)
INK = (26, 26, 31)
MUTED = (107, 107, 117)
BORDER = (232, 227, 217)

_DISCLAIMER = (
    "Document d'aide à la préparation, généré automatiquement à partir de vos factures émises. "
    "Vérifiez ces chiffres avec votre expert-comptable avant toute décision ou déclaration."
)


def _eur(n: float) -> str:
    return f"{n:,.2f} €".replace(",", " ").replace(".", ",")


def rapport_to_pdf(rapport: RapportActivite) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    font = "Helvetica"

    def texte(s: str) -> str:
        return (s or "").encode("latin-1", "replace").decode("latin-1")

    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 32, style="F")
    pdf.set_xy(16, 10)
    pdf.set_text_color(253, 251, 246)
    pdf.set_font(font, "B", 18)
    pdf.cell(0, 8, texte("RAPPORT D'ACTIVITÉ"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 11)
    pdf.cell(0, 6, texte(
        f"Du {rapport.date_debut.strftime('%d/%m/%Y')} au {rapport.date_fin.strftime('%d/%m/%Y')}"
    ), ln=1)

    pdf.set_text_color(*INK)
    pdf.set_xy(16, 40)

    pdf.set_font(font, "B", 12)
    pdf.cell(0, 7, texte("Chiffres clés de la période"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 9.5)
    for c in rapport.chiffres_cles:
        pdf.set_x(16)
        suffixe = f"  ({c.source})" if c.source else ""
        pdf.multi_cell(0, 5.5, texte(f"{c.libelle} : {c.valeur}{suffixe}"))
    pdf.ln(3)

    pdf.set_fill_color(*BUTTER_BG)
    pdf.set_text_color(*BUTTER_INK)
    pdf.set_font(font, "B", 11)
    pdf.set_x(16)
    pdf.cell(0, 9, texte(
        f"Position vis-à-vis du seuil : {rapport.position_vs_seuil_pct:.0f} % "
        f"({_eur(rapport.total_ht)} / {_eur(rapport.seuil_applicable)})"
    ), fill=True, ln=1)
    pdf.set_text_color(*INK)
    pdf.ln(4)

    pdf.set_x(16)
    pdf.set_font(font, "B", 12)
    pdf.cell(0, 7, texte("Appréciation"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 9.5)
    pdf.multi_cell(0, 5, texte(rapport.appreciation))
    pdf.ln(3)

    if rapport.signaux_conformite:
        pdf.set_x(16)
        pdf.set_fill_color(*PLUM_BG)
        pdf.set_font(font, "B", 10)
        pdf.cell(0, 7, texte("Points à vérifier"), ln=1)
        pdf.set_font(font, "", 9)
        for s in rapport.signaux_conformite:
            pdf.set_x(16)
            pdf.multi_cell(0, 5, texte(f"- {s.question}"))
        pdf.ln(2)

    if rapport.sources:
        pdf.set_x(16)
        pdf.set_font(font, "B", 9)
        pdf.cell(0, 6, texte("Sources"), ln=1)
        pdf.set_font(font, "", 7.5)
        pdf.set_text_color(*MUTED)
        for s in rapport.sources:
            pdf.set_x(16)
            pdf.multi_cell(0, 4, texte(s))
        pdf.set_text_color(*INK)

    pdf.ln(4)
    pdf.set_x(16)
    pdf.set_draw_color(*BORDER)
    pdf.line(16, pdf.get_y(), 194, pdf.get_y())
    pdf.ln(4)
    pdf.set_x(16)
    pdf.set_font(font, "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 4, texte(_DISCLAIMER))

    return bytes(pdf.output())
