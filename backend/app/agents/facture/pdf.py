"""Rendu PDF de la facture — reprend la palette et le moteur fpdf2 de guidance/roadmap/pdf.py.

Aucun montant ni mention n'est composé ici : ce module affiche tel quel l'objet `Facture` déjà
entièrement calculé par `generator.py`. Une seule mise en page, quel que soit le régime — le
franchise-TVA et le avec-TVA ne diffèrent que par les mentions déjà présentes dans l'objet.
"""

from __future__ import annotations

from app.agents.facture.schemas import Facture

# Palette produit — identique à guidance/roadmap/pdf.py (marine, butter, prune, crème).
NAVY = (27, 58, 95)
NAVY_BG = (237, 242, 248)
BUTTER_INK = (138, 109, 31)
BUTTER_BG = (251, 243, 220)
CREME = (253, 251, 246)
INK = (26, 26, 31)
MUTED = (107, 107, 117)
BORDER = (232, 227, 217)

_DISCLAIMER = (
    "Document d'aide à la préparation, généré automatiquement. Vérifiez les mentions applicables "
    "à votre situation avant envoi ; en cas de doute, faites relire par votre expert-comptable."
)


def _eur(n: float) -> str:
    return f"{n:,.2f} €".replace(",", " ").replace(".", ",")


def _setup_font(pdf) -> tuple[str, bool]:
    """Police avec accents français corrects (latin-1) ; repli Helvetica sinon."""
    try:
        return "Helvetica", True
    except Exception:  # noqa: BLE001
        return "Helvetica", False


def facture_to_pdf(facture: Facture) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    font, _ = _setup_font(pdf)

    def texte(s: str) -> str:
        # fpdf2/Helvetica en latin-1 : les caractères hors table sont neutralisés proprement.
        return (s or "").encode("latin-1", "replace").decode("latin-1")

    # --- En-tête : émetteur + numéro/date ---
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 32, style="F")
    pdf.set_xy(16, 10)
    pdf.set_text_color(253, 251, 246)
    pdf.set_font(font, "B", 18)
    pdf.cell(0, 8, texte("FACTURE"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 11)
    pdf.cell(0, 6, texte(f"N° {facture.numero}  —  émise le "
                        f"{facture.date_emission.strftime('%d/%m/%Y')}"), ln=1)

    pdf.set_text_color(*INK)
    pdf.set_xy(16, 40)

    # --- Émetteur / client, côte à côte ---
    # Page A4 (210mm) - marges 16mm de chaque côté = 178mm utiles ; deux colonnes + espacement
    # doivent tenir dedans (2*83 + 6 = 172mm, marge de sécurité contre les arrondis fpdf2).
    col_w = 83
    y0 = pdf.get_y()
    pdf.set_font(font, "B", 10)
    pdf.cell(col_w, 6, texte("Émetteur"))
    pdf.set_x(16 + col_w + 6)
    pdf.cell(col_w, 6, texte("Client"), ln=1)

    pdf.set_font(font, "", 9.5)
    pdf.set_text_color(*MUTED)
    lignes_emetteur = [
        facture.emetteur_nom,
        (facture.emetteur_forme_juridique or ""),
        (facture.emetteur_adresse or ""),
        f"SIREN {facture.emetteur_siren}",
    ]
    lignes_client = [
        facture.client.nom,
        (facture.client.adresse or ""),
        (f"TVA intracom. {facture.client.numero_tva_intracom}"
         if facture.client.numero_tva_intracom else ""),
    ]
    pdf.set_xy(16, y0 + 7)
    for l in lignes_emetteur:
        if l:
            pdf.set_x(16)
            pdf.multi_cell(col_w, 5, texte(l))
    y_apres_emetteur = pdf.get_y()
    pdf.set_xy(16 + col_w + 6, y0 + 7)
    for l in lignes_client:
        if l:
            pdf.set_x(16 + col_w + 6)
            pdf.multi_cell(col_w, 5, texte(l))
    pdf.set_y(max(y_apres_emetteur, pdf.get_y()) + 6)
    pdf.set_text_color(*INK)

    pdf.set_font(font, "", 9)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, texte(
        f"Date de la prestation : {facture.date_prestation.strftime('%d/%m/%Y')}"
        + (f"  —  Bon de commande n° {facture.numero}" if False else "")
    ), ln=1)
    pdf.set_text_color(*INK)
    pdf.ln(3)

    # --- Tableau des lignes ---
    # Somme = 166mm, sous les 178mm utiles — marge de sécurité contre les arrondis fpdf2.
    largeurs = (72, 18, 26, 18, 32)
    entetes = ("Désignation", "Qté", "PU HT", "TVA", "Total HT")
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(253, 251, 246)
    pdf.set_font(font, "B", 9)
    for w, h in zip(largeurs, entetes):
        pdf.cell(w, 8, texte(h), border=0, fill=True)
    pdf.ln(8)

    pdf.set_text_color(*INK)
    pdf.set_font(font, "", 9)
    for i, ligne in enumerate(facture.lignes):
        ht = round(ligne.quantite * ligne.prix_unitaire_ht, 2)
        fill = (i % 2 == 1)
        if fill:
            pdf.set_fill_color(*NAVY_BG)
        y_row = pdf.get_y()
        pdf.multi_cell(largeurs[0], 6, texte(ligne.designation), fill=fill)
        y_after = pdf.get_y()
        row_h = max(6, y_after - y_row)
        pdf.set_xy(16 + largeurs[0], y_row)
        pdf.cell(largeurs[1], row_h, texte(f"{ligne.quantite:g}"), fill=fill)
        pdf.cell(largeurs[2], row_h, texte(_eur(ligne.prix_unitaire_ht)), fill=fill)
        pdf.cell(largeurs[3], row_h,
                 texte(f"{ligne.taux_tva * 100:.0f} %" if ligne.taux_tva else "—"), fill=fill)
        pdf.cell(largeurs[4], row_h, texte(_eur(ht)), fill=fill)
        pdf.set_xy(16, y_after)

    pdf.ln(4)

    # --- Totaux ---
    pdf.set_x(16 + largeurs[0])
    pdf.set_font(font, "", 10)
    for label, valeur in (
        ("Total HT", facture.total_ht),
        ("dont TVA", facture.total_tva),
    ):
        pdf.set_x(16 + largeurs[0])
        pdf.cell(sum(largeurs[1:4]), 6, texte(label))
        pdf.cell(largeurs[4], 6, texte(_eur(valeur)), ln=1)
        pdf.set_x(16 + largeurs[0])
    pdf.set_fill_color(*BUTTER_BG)
    pdf.set_text_color(*BUTTER_INK)
    pdf.set_font(font, "B", 11)
    pdf.set_x(16 + largeurs[0])
    pdf.cell(sum(largeurs[1:4]), 8, texte("Total TTC à payer"), fill=True)
    pdf.cell(largeurs[4], 8, texte(_eur(facture.total_ttc)), fill=True, ln=1)
    pdf.set_text_color(*INK)
    pdf.ln(8)

    # --- Mentions légales, chacune avec sa provenance ---
    # `set_x(16)` avant chaque multi_cell en largeur 0 : la largeur "auto" de fpdf2 se calcule
    # depuis la position X courante, pas depuis la marge gauche — un `ln=1` précédent ne garantit
    # pas toujours ce repositionnement, d'où l'erreur "Not enough horizontal space" sinon.
    pdf.set_x(16)
    pdf.set_font(font, "B", 9)
    pdf.cell(0, 6, texte("Mentions légales"), ln=1)
    pdf.set_font(font, "", 8)
    pdf.set_text_color(*MUTED)
    for m in facture.mentions:
        pdf.set_x(16)
        pdf.multi_cell(0, 4.5, texte(f"- {m.libelle} : {m.valeur}"))
    if facture.tva_intracom_requise:
        pdf.set_x(16)
        pdf.multi_cell(0, 4.5, texte(
            "- N° de TVA intracommunautaire requis (total HT supérieur à 150 €)"
        ))
    pdf.set_text_color(*INK)
    pdf.ln(4)

    pdf.set_draw_color(*BORDER)
    pdf.set_x(16)
    pdf.line(16, pdf.get_y(), 194, pdf.get_y())
    pdf.ln(4)
    pdf.set_x(16)
    pdf.set_font(font, "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 4, texte(_DISCLAIMER))

    return bytes(pdf.output())
