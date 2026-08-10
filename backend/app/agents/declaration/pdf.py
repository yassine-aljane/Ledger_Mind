"""Rendu PDF de la déclaration préparée — bandeau « brouillon » explicite, chaque case tracée.

Même palette que facture/pdf.py et rapport/pdf.py. Rien n'est composé ici : l'objet
`Declaration` est déjà entièrement calculé, avec la provenance de chaque case.
"""

from __future__ import annotations

from app.agents.declaration.schemas import Declaration

NAVY = (27, 58, 95)
NAVY_BG = (237, 242, 248)
BUTTER_INK = (138, 109, 31)
BUTTER_BG = (251, 243, 220)
PLUM = (122, 74, 99)
PLUM_BG = (243, 233, 239)
PLUM_INK = (102, 62, 83)
INK = (26, 26, 31)
MUTED = (107, 107, 117)
BORDER = (232, 227, 217)


def _eur(n: float) -> str:
    return f"{n:,.2f} €".replace(",", " ").replace(".", ",")


def declaration_to_pdf(declaration: Declaration) -> bytes:
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
    pdf.cell(0, 8, texte(f"DÉCLARATION {declaration.formulaire} — BROUILLON"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 11)
    pdf.cell(0, 6, texte(
        f"Période du {declaration.date_debut.strftime('%d/%m/%Y')} au "
        f"{declaration.date_fin.strftime('%d/%m/%Y')} — {declaration.regime}"
    ), ln=1)

    pdf.set_text_color(*INK)
    pdf.set_xy(16, 40)

    # Bandeau d'avertissement — le document n'est PAS transmis, doit sauter aux yeux.
    pdf.set_fill_color(*PLUM_BG)
    pdf.set_text_color(*PLUM_INK)
    pdf.set_font(font, "B", 9)
    pdf.set_x(16)
    pdf.multi_cell(0, 5, texte(declaration.avertissement), fill=True)
    pdf.set_text_color(*INK)
    pdf.ln(4)

    pdf.set_x(16)
    pdf.set_font(font, "B", 12)
    pdf.cell(0, 7, texte(f"Cases du formulaire {declaration.formulaire}"), ln=1)
    pdf.set_font(font, "", 9)
    pdf.set_x(16)
    pdf.multi_cell(0, 5, texte(f"Source des numéros de case : {declaration.source_formulaire}"))
    pdf.ln(2)

    for ligne in declaration.lignes:
        pdf.set_x(16)
        pdf.set_fill_color(*NAVY_BG)
        pdf.set_font(font, "B", 10)
        pdf.cell(25, 8, texte(f"Case {ligne.case}"), fill=True)
        pdf.set_font(font, "", 9.5)
        pdf.cell(0, 8, texte(f"{ligne.libelle} : {_eur(ligne.montant)}"), fill=True, ln=1)
        pdf.set_x(16)
        pdf.set_font(font, "", 8)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 4.5, texte(f"Provenance : {ligne.provenance}"))
        # La part reçue en nature se justifie autrement qu'une facture — ni numéro, ni
        # virement au relevé. En cas de contrôle, c'est cette ligne qui dit où regarder.
        if ligne.montant_nature > 0:
            pdf.set_x(16)
            pdf.multi_cell(0, 4.5, texte(
                f"dont {_eur(ligne.montant_facture)} facturés et "
                f"{_eur(ligne.montant_nature)} reçus en nature"
            ))
        pdf.set_text_color(*INK)
        pdf.ln(1)

    pdf.ln(3)
    pdf.set_fill_color(*BUTTER_BG)
    pdf.set_text_color(*BUTTER_INK)
    pdf.set_font(font, "B", 11)
    pdf.set_x(16)
    pdf.cell(0, 9, texte(f"Total chiffre d'affaires déclaré : {_eur(declaration.total_ca_declare)}"),
             fill=True, ln=1)
    pdf.set_text_color(*INK)
    pdf.ln(3)

    # Ce que le brouillon NE contient PAS : une omission silencieuse dans un document
    # destiné à être recopié sur impots.gouv.fr deviendrait une omission déclarative.
    if declaration.cadeaux_ecartes:
        pdf.set_x(16)
        pdf.set_font(font, "B", 9)
        pdf.cell(0, 6, texte("Avantages en nature NON repris dans les cases ci-dessus"), ln=1)
        pdf.set_font(font, "", 8)
        pdf.set_text_color(*MUTED)
        for motif in declaration.cadeaux_ecartes:
            pdf.set_x(16)
            pdf.multi_cell(0, 4.5, texte(f"— {motif}"))
        pdf.set_text_color(*INK)
        pdf.ln(3)

    pdf.set_x(16)
    pdf.set_font(font, "B", 10)
    pdf.cell(0, 6, texte("Circuit URSSAF (distinct, se cumule avec la déclaration fiscale)"), ln=1)
    pdf.set_font(font, "", 9)
    pdf.set_x(16)
    pdf.multi_cell(0, 5, texte(
        f"Cotisations sociales estimées : {_eur(declaration.cotisations_urssac_estimees)} "
        f"(taux {declaration.cotisations_urssac_taux * 100:.1f} %) — "
        f"source : {declaration.cotisations_urssac_source}"
    ))
    pdf.ln(4)

    pdf.set_x(16)
    pdf.set_draw_color(*BORDER)
    pdf.line(16, pdf.get_y(), 194, pdf.get_y())
    pdf.ln(4)
    pdf.set_x(16)
    pdf.set_font(font, "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 4, texte(
        f"Statut : {declaration.statut}. Généré le {declaration.created_at[:10]}. "
        + declaration.avertissement
    ))

    return bytes(pdf.output())
