"""Rendu PDF de la facture — reprend la palette et le moteur fpdf2 de guidance/roadmap/pdf.py.

Aucun montant ni mention n'est composé ici : ce module affiche tel quel l'objet `Facture` déjà
entièrement calculé par `generator.py`. Une seule mise en page, quel que soit le régime — le
franchise-TVA et le avec-TVA ne diffèrent que par les mentions déjà présentes dans l'objet.
"""

from __future__ import annotations

import os

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


# Polices Unicode du système, essayées dans l'ordre. Sans l'une d'elles, Helvetica
# (latin-1) ne sait pas rendre « € » ni les tirets cadratins : ils sortaient en « ? ».
_FONT_CANDIDATES = [
    ("arial", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    ("segoeui", r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\segoeuib.ttf"),
    ("dejavu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]

# Repli si aucune police Unicode n'est disponible : transposition explicite plutôt
# qu'un « ? » muet. Même table que guidance/roadmap/pdf.py.
_LATIN1_REPL = {
    "—": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...",
    "€": " EUR", "«": '"', "»": '"', "→": "->", "\u202f": " ", "\u00a0": " ", "•": "-",
}


def _setup_font(pdf) -> tuple[str, bool]:
    """Enregistre une police Unicode si le système en offre une ; sinon Helvetica."""
    for family, reg, bold in _FONT_CANDIDATES:
        if os.path.exists(reg):
            try:
                pdf.add_font(family, "", reg)
                pdf.add_font(family, "B", bold if os.path.exists(bold) else reg)
                return family, True
            except Exception:  # noqa: BLE001 - police illisible : on tente la suivante
                continue
    return "Helvetica", False


def _eur(n: float, unicode_ok: bool = True) -> str:
    """Montant formaté à la française. Sans police Unicode, « € » devient « EUR »."""
    devise = "€" if unicode_ok else "EUR"
    return f"{n:,.2f} {devise}".replace(",", " ").replace(".", ",")


def facture_to_pdf(facture: Facture) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    font, unicode_ok = _setup_font(pdf)

    def texte(s: str) -> str:
        """Rend le texte tel quel avec une police Unicode ; transpose sinon.

        L'ancien `encode("latin-1", "replace")` seul transformait tout « € » et tout
        tiret cadratin en « ? » sur la facture.
        """
        s = s or ""
        if unicode_ok:
            return s
        for k, v in _LATIN1_REPL.items():
            s = s.replace(k, v)
        return s.encode("latin-1", "replace").decode("latin-1")

    def eur(n: float) -> str:
        return _eur(n, unicode_ok)

    # --- En-tête : émetteur + numéro/date ---
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 32, style="F")
    pdf.set_xy(16, 10)
    pdf.set_text_color(253, 251, 246)
    pdf.set_font(font, "B", 18)
    pdf.cell(0, 8, texte("FACTURE"), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 11)
    # Un brouillon n'a ni numéro ni date d'émission : il se rend quand même, en le disant.
    if facture.numero and facture.date_emission:
        entete = (f"N° {facture.numero}  —  émise le "
                  f"{facture.date_emission.strftime('%d/%m/%Y')}")
    else:
        entete = "BROUILLON — sans valeur légale, non numéroté"
    if facture.facture_origine_numero:
        entete += f"  —  annule la facture {facture.facture_origine_numero}"
    pdf.cell(0, 6, texte(entete), ln=1)

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
        # Obligatoire au-delà du seuil de dispense (fiche F31808).
        (f"TVA intracom. {facture.emetteur_tva_intracom}"
         if facture.emetteur_tva_intracom else ""),
        (f"RC Pro n° {facture.emetteur_rc_pro}" if facture.emetteur_rc_pro else ""),
    ]
    lignes_client = [
        facture.client.nom,
        (facture.client.adresse or ""),
        # SIRET obligatoire pour un client professionnel (fiche F31808).
        (f"SIRET {facture.client.siret}" if facture.client.siret else ""),
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
    # Conditions de règlement : mention obligatoire (fiche F31808).
    reperes = [f"Date de la prestation : {facture.date_prestation.strftime('%d/%m/%Y')}"]
    if facture.date_echeance:
        echeance = f"Échéance : {facture.date_echeance.strftime('%d/%m/%Y')}"
        if facture.delai_paiement_jours is not None:
            echeance += f" ({facture.delai_paiement_jours} jours)"
        reperes.append(echeance)
    if facture.mode_paiement:
        reperes.append(f"Mode de règlement : {facture.mode_paiement}")
    if facture.numero_bon_commande:
        reperes.append(f"Bon de commande n° {facture.numero_bon_commande}")
    if facture.numero_contrat:
        reperes.append(f"Contrat n° {facture.numero_contrat}")
    for repere in reperes:
        pdf.set_x(16)
        pdf.cell(0, 5, texte(repere), ln=1)
    pdf.set_text_color(*INK)
    pdf.ln(3)

    # --- Tableau des lignes ---
    # Somme = 166mm, sous les 178mm utiles — marge de sécurité contre les arrondis fpdf2.
    largeurs = (58, 14, 26, 18, 18, 32)
    entetes = ("Désignation", "Qté", "PU HT", "Remise", "TVA", "Total HT")
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(253, 251, 246)
    pdf.set_font(font, "B", 9)
    for w, h in zip(largeurs, entetes):
        pdf.cell(w, 8, texte(h), border=0, fill=True)
    pdf.ln(8)

    pdf.set_text_color(*INK)
    pdf.set_font(font, "", 9)
    for i, ligne in enumerate(facture.lignes):
        # MÊME calcul que `generator._ligne_totaux` : la remise s'applique AVANT la TVA.
        # Sans elle, le total de ligne contredisait le total du document.
        remise = ligne.remise_pourcent or 0.0
        ht = round(ligne.quantite * ligne.prix_unitaire_ht * (1 - remise / 100), 2)
        fill = (i % 2 == 1)
        if fill:
            pdf.set_fill_color(*NAVY_BG)
        y_row = pdf.get_y()
        pdf.multi_cell(largeurs[0], 6, texte(ligne.designation), fill=fill)
        y_after = pdf.get_y()
        row_h = max(6, y_after - y_row)
        pdf.set_xy(16 + largeurs[0], y_row)
        pdf.cell(largeurs[1], row_h, texte(f"{ligne.quantite:g}"), fill=fill)
        pdf.cell(largeurs[2], row_h, texte(eur(ligne.prix_unitaire_ht)), fill=fill)
        pdf.cell(largeurs[3], row_h, texte(f"{remise:g} %" if remise else "—"), fill=fill)
        pdf.cell(largeurs[4], row_h,
                 texte(f"{ligne.taux_tva * 100:.0f} %" if ligne.taux_tva else "—"), fill=fill)
        pdf.cell(largeurs[5], row_h, texte(eur(ht)), fill=fill)
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
        pdf.cell(sum(largeurs[1:5]), 6, texte(label))
        pdf.cell(largeurs[5], 6, texte(eur(valeur)), ln=1)
        pdf.set_x(16 + largeurs[0])
    # Acompte déjà versé : la déduction doit se lire, et référencer sa facture d'origine.
    if facture.acompte:
        pdf.set_x(16 + largeurs[0])
        libelle = "Acompte déjà versé"
        if facture.acompte.facture_numero:
            libelle += f" (facture {facture.acompte.facture_numero})"
        pdf.cell(sum(largeurs[1:5]), 6, texte(libelle))
        pdf.cell(largeurs[5], 6, texte(f"- {eur(facture.acompte.montant_ttc)}"), ln=1)

    pdf.set_fill_color(*BUTTER_BG)
    pdf.set_text_color(*BUTTER_INK)
    pdf.set_font(font, "B", 11)
    pdf.set_x(16 + largeurs[0])
    intitule = "Net à payer" if facture.acompte else "Total TTC à payer"
    if facture.type_document == "avoir":
        intitule = "Montant de l'avoir"
    pdf.cell(sum(largeurs[1:5]), 8, texte(intitule), fill=True)
    pdf.cell(largeurs[5], 8, texte(eur(facture.net_a_payer)), fill=True, ln=1)
    pdf.set_text_color(*INK)

    # Coordonnées de règlement + référence à rappeler : c'est ce qui permettra à l'agent
    # de rapprochement de relier le virement reçu à cette facture.
    if facture.emetteur_iban and facture.numero:
        pdf.ln(3)
        pdf.set_x(16)
        pdf.set_font(font, "", 9)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 5, texte(
            f"Règlement par virement — IBAN {facture.emetteur_iban}. "
            f"Merci d'indiquer la référence « {facture.numero} » dans le libellé."
        ))
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
