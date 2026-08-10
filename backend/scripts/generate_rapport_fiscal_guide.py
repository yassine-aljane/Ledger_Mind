"""Génère le guide explicatif du rapport fiscal LedgerMind.

Depuis la racine du dépôt :
    python -m backend.scripts.generate_rapport_fiscal_guide

Le document décrit le comportement réellement implémenté. L'exemple chiffré est produit par
le moteur fiscal du projet au moment de la génération : aucune formule parallèle n'est créée.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import Iterable, Sequence

from fpdf.enums import XPos, YPos

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.facture.pdf import (  # noqa: E402
    BORDER,
    BUTTER_BG,
    BUTTER_INK,
    CREME,
    INK,
    MUTED,
    NAVY,
    NAVY_BG,
    _LATIN1_REPL,
    _setup_font,
)
from app.agents.impots.tools import simuler_impots  # noqa: E402
from app.core.paths import REPO_ROOT  # noqa: E402

PLUM = (122, 74, 99)
PLUM_BG = (243, 233, 239)
GREEN = (43, 107, 84)
GREEN_BG = (232, 245, 239)
RED = (150, 42, 42)
RED_BG = (252, 238, 238)
WHITE = (255, 255, 255)

DEFAULT_OUTPUT = REPO_ROOT / "docs" / "Guide_LedgerMind_Rapport_Fiscal.pdf"
VERSION = "06 août 2026"


def _guide_class():
    from fpdf import FPDF

    class Guide(FPDF):
        font_family = "Helvetica"
        render_text = staticmethod(lambda value: value)

        def header(self) -> None:
            if self.page_no() == 1:
                return
            self.set_y(8)
            self.set_font(self.font_family, "B", 8)
            self.set_text_color(*NAVY)
            self.cell(0, 4, self.render_text("LEDGERMIND  /  GUIDE DU RAPPORT FISCAL"))
            self.set_draw_color(*BORDER)
            self.line(16, 14, 194, 14)

        def footer(self) -> None:
            self.set_y(-14)
            self.set_draw_color(*BORDER)
            self.line(16, self.get_y(), 194, self.get_y())
            self.ln(2)
            self.set_font(self.font_family, "", 7)
            self.set_text_color(*MUTED)
            self.cell(
                145,
                4,
                self.render_text(
                    "Document explicatif — ne vaut ni déclaration fiscale ni conseil professionnel."
                ),
            )
            self.cell(33, 4, self.render_text(f"{self.page_no()} / {{nb}}"), align="R")

    return Guide


def build_pdf() -> bytes:
    from fpdf.enums import MethodReturnValue

    pdf = _guide_class()(format="A4", unit="mm")
    pdf.set_margins(16, 19, 16)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.alias_nb_pages()
    font, unicode_ok = _setup_font(pdf)

    def text(value: str) -> str:
        value = value or ""
        if unicode_ok:
            return value
        for source, replacement in _LATIN1_REPL.items():
            value = value.replace(source, replacement)
        return value.encode("latin-1", "replace").decode("latin-1")

    pdf.font_family = font
    pdf.render_text = text

    def ensure(height: float) -> None:
        if pdf.get_y() + height > 272:
            pdf.add_page()

    def paragraph(value: str, *, size: float = 9.2, color=INK, leading: float = 4.7) -> None:
        pdf.set_font(font, "", size)
        pdf.set_text_color(*color)
        pdf.multi_cell(178, leading, text(value))
        pdf.ln(1.2)

    def label(value: str) -> None:
        pdf.set_font(font, "B", 7.2)
        pdf.set_text_color(*PLUM)
        pdf.cell(0, 4, text(value.upper()), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def chapter(number: str, title: str, intro: str | None = None) -> None:
        pdf.add_page()
        pdf.set_y(23)
        label(f"CHAPITRE {number}")
        pdf.set_font(font, "B", 20)
        pdf.set_text_color(*NAVY)
        pdf.multi_cell(178, 8.5, text(title))
        pdf.set_draw_color(*PLUM)
        pdf.set_line_width(1.1)
        pdf.line(16, pdf.get_y() + 1.5, 50, pdf.get_y() + 1.5)
        pdf.ln(6)
        if intro:
            paragraph(intro, size=10.2, color=MUTED, leading=5.1)

    def heading(title: str) -> None:
        ensure(14)
        pdf.ln(2)
        pdf.set_font(font, "B", 12)
        pdf.set_text_color(*NAVY)
        pdf.cell(0, 7, text(title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_draw_color(*BORDER)
        pdf.line(16, pdf.get_y(), 194, pdf.get_y())
        pdf.ln(2)

    def bullets(items: Iterable[str], *, color=INK) -> None:
        for item in items:
            ensure(8)
            y = pdf.get_y()
            pdf.set_fill_color(*PLUM)
            pdf.ellipse(17, y + 1.7, 2, 2, style="F")
            pdf.set_xy(22, y)
            pdf.set_font(font, "", 9)
            pdf.set_text_color(*color)
            pdf.multi_cell(171, 4.5, text(item))
            pdf.ln(0.8)

    def callout(title: str, body: str, *, kind: str = "info") -> None:
        palette = {
            "info": (NAVY, NAVY_BG),
            "warning": (BUTTER_INK, BUTTER_BG),
            "danger": (RED, RED_BG),
            "success": (GREEN, GREEN_BG),
        }
        ink, background = palette[kind]
        pdf.set_font(font, "", 8.7)
        lines = pdf.multi_cell(
            162, 4.3, text(body), dry_run=True, output=MethodReturnValue.LINES
        )
        height = max(18, 11 + len(lines) * 4.3)
        ensure(height + 3)
        x, y = 16, pdf.get_y()
        pdf.set_fill_color(*background)
        pdf.set_draw_color(*ink)
        pdf.set_line_width(0.35)
        pdf.rect(x, y, 178, height, style="DF", round_corners=True)
        pdf.set_xy(x + 7, y + 4)
        pdf.set_font(font, "B", 9)
        pdf.set_text_color(*ink)
        pdf.cell(164, 4.5, text(title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(x + 7)
        pdf.set_font(font, "", 8.7)
        pdf.multi_cell(164, 4.3, text(body))
        pdf.set_y(y + height + 3)

    def formula(title: str, expression: str, note: str) -> None:
        ensure(25)
        x, y = 16, pdf.get_y()
        pdf.set_fill_color(*NAVY_BG)
        pdf.set_draw_color(*BORDER)
        pdf.rect(x, y, 178, 22, style="DF", round_corners=True)
        pdf.set_xy(x + 6, y + 3.5)
        pdf.set_font(font, "B", 8.2)
        pdf.set_text_color(*NAVY)
        pdf.cell(50, 4, text(title.upper()))
        pdf.set_font(font, "B", 9.3)
        pdf.set_text_color(*INK)
        pdf.multi_cell(116, 4.2, text(expression))
        pdf.set_xy(x + 6, y + 13)
        pdf.set_font(font, "", 7.7)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(166, 3.8, text(note))
        pdf.set_y(y + 25)

    def table(headers: Sequence[str], rows: Sequence[Sequence[str]], widths: Sequence[float]) -> None:
        assert abs(sum(widths) - 178) < 0.2
        line_h = 4.1

        def row_height(values: Sequence[str], bold: bool = False) -> float:
            pdf.set_font(font, "B" if bold else "", 7.4 if bold else 7.2)
            counts = []
            for value, width in zip(values, widths, strict=True):
                lines = pdf.multi_cell(
                    width - 4,
                    line_h,
                    text(value),
                    dry_run=True,
                    output=MethodReturnValue.LINES,
                )
                counts.append(len(lines))
            return max(8, max(counts, default=1) * line_h + 3)

        def draw(values: Sequence[str], *, header: bool = False) -> None:
            h = row_height(values, header)
            ensure(h + 1)
            x0, y0 = 16, pdf.get_y()
            x = x0
            for value, width in zip(values, widths, strict=True):
                pdf.set_fill_color(*(NAVY if header else WHITE))
                pdf.set_draw_color(*BORDER)
                pdf.rect(x, y0, width, h, style="DF")
                pdf.set_xy(x + 2, y0 + 1.5)
                pdf.set_font(font, "B" if header else "", 7.4 if header else 7.2)
                pdf.set_text_color(*(CREME if header else INK))
                pdf.multi_cell(width - 4, line_h, text(value))
                x += width
            pdf.set_xy(x0, y0 + h)

        draw(headers, header=True)
        for row in rows:
            draw(row)
        pdf.ln(3)

    def step_card(number: int, title: str, body: str, x: float, y: float) -> None:
        pdf.set_fill_color(*WHITE)
        pdf.set_draw_color(*BORDER)
        pdf.rect(x, y, 85, 27, style="DF", round_corners=True)
        pdf.set_fill_color(*PLUM)
        pdf.ellipse(x + 5, y + 5, 9, 9, style="F")
        pdf.set_xy(x + 5, y + 6.4)
        pdf.set_font(font, "B", 7.5)
        pdf.set_text_color(*CREME)
        pdf.cell(9, 5, str(number), align="C")
        pdf.set_xy(x + 18, y + 4)
        pdf.set_font(font, "B", 8.5)
        pdf.set_text_color(*NAVY)
        pdf.cell(61, 5, text(title))
        pdf.set_xy(x + 18, y + 10)
        pdf.set_font(font, "", 7.1)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(61, 3.6, text(body))

    def source_link(label_text: str, url: str, status: str) -> None:
        ensure(14)
        y = pdf.get_y()
        pdf.set_fill_color(*NAVY_BG)
        pdf.ellipse(17, y + 1.5, 3, 3, style="F")
        pdf.set_xy(23, y)
        pdf.set_font(font, "B", 8.5)
        pdf.set_text_color(*NAVY)
        pdf.write(4.3, text(label_text), link=url)
        pdf.ln(4.7)
        pdf.set_x(23)
        pdf.set_font(font, "", 7.2)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(168, 3.7, text(f"{status}  ·  {url}"))
        pdf.ln(1)

    # ------------------------------------------------------------------ Cover
    pdf.add_page()
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 297, style="F")
    pdf.set_fill_color(*PLUM)
    pdf.ellipse(145, -28, 90, 90, style="F")
    pdf.set_fill_color(242, 217, 141)
    pdf.ellipse(163, 20, 25, 25, style="F")
    pdf.set_fill_color(*NAVY_BG)
    pdf.ellipse(-25, 222, 95, 95, style="F")
    pdf.set_xy(18, 28)
    pdf.set_font(font, "B", 9)
    pdf.set_text_color(242, 217, 141)
    pdf.cell(
        0,
        5,
        text("LEDGERMIND  /  DOCUMENTATION PRODUIT"),
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.set_xy(18, 66)
    pdf.set_font(font, "B", 28)
    pdf.set_text_color(*CREME)
    pdf.multi_cell(170, 11, text("Comprendre le\nrapport fiscal"))
    pdf.ln(4)
    pdf.set_x(18)
    pdf.set_font(font, "", 14)
    pdf.set_text_color(222, 229, 239)
    pdf.multi_cell(
        164,
        7,
        text(
            "Procédure de génération, origine des données, formules de calcul, règles appliquées "
            "et contrôles de fiabilité."
        ),
    )
    pdf.set_xy(18, 158)
    pdf.set_fill_color(242, 217, 141)
    pdf.rect(18, 158, 66, 22, style="F", round_corners=True)
    pdf.set_xy(24, 164)
    pdf.set_font(font, "B", 10)
    pdf.set_text_color(*NAVY)
    pdf.cell(54, 5, text("Moteur déterministe"), align="C")
    pdf.set_xy(18, 194)
    pdf.set_font(font, "", 9)
    pdf.set_text_color(222, 229, 239)
    pdf.multi_cell(
        172,
        5,
        text(
            "Périmètre : micro-entreprise française · version des tables 2026\n"
            f"Guide généré le {VERSION} à partir du code et des tables du dépôt."
        ),
    )
    pdf.set_xy(18, 260)
    pdf.set_font(font, "B", 11)
    pdf.set_text_color(*CREME)
    pdf.cell(0, 6, text("LedgerMind"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(18)
    pdf.set_font(font, "", 8)
    pdf.set_text_color(196, 209, 224)
    pdf.cell(0, 5, text("Copilote fiscal des créateurs et indépendants"))

    # -------------------------------------------------------------- Chapter 1
    chapter(
        "01",
        "Ce que fait réellement le rapport",
        "Le rapport fiscal est une photographie archivée d'une période. Il part des encaissements "
        "réels, les rattache aux factures, applique le moteur fiscal puis rend chaque hypothèse et "
        "chaque source visibles. Il ne dépose aucune déclaration.",
    )
    callout(
        "Règle centrale",
        "L'assiette est le chiffre d'affaires encaissé hors taxe, jamais le chiffre d'affaires "
        "simplement facturé. Une facture impayée est suivie, mais elle n'entre dans le calcul "
        "qu'au moment où le règlement est effectivement reçu.",
        kind="success",
    )
    heading("Le parcours en huit étapes")
    y = pdf.get_y()
    cards = [
        ("Choisir la période", "Dates de début et de fin du rapport."),
        ("Préremplir le contexte", "Profil fiscal affiché puis corrigeable."),
        ("Réunir les pièces", "Factures, virements, contrats et dépenses."),
        ("Rapprocher", "Chaque virement est relié à une facture."),
        ("Construire le CA HT", "Somme des encaissements justifiés et ventilés."),
        ("Calculer", "Abattement, IR, cotisations, CFP et option VFL."),
        ("Contrôler", "Plafonds micro, TVA, ACRE, anomalies et limites."),
        ("Archiver et exporter", "Instantané JSON puis PDF sans nouveau calcul."),
    ]
    for index, (title, body) in enumerate(cards, 1):
        col = (index - 1) % 2
        row = (index - 1) // 2
        step_card(index, title, body, 16 + col * 93, y + row * 32)
    pdf.set_y(y + 132)
    heading("Principes de confiance")
    bullets(
        [
            "Aucun LLM n'effectue les calculs fiscaux : le moteur Python est déterministe et testable.",
            "Aucun taux n'est caché dans un prompt : les valeurs viennent de fichiers YAML versionnés.",
            "Une information manquante reste « non calculée » ; elle n'est jamais remplacée par une estimation silencieuse.",
            "Les arrondis sont appliqués à la sortie seulement ; le moteur conserve la pleine précision entre les étapes.",
            "Le PDF affiche l'instantané archivé et ne recalcule aucun montant au téléchargement.",
        ]
    )

    # -------------------------------------------------------------- Chapter 2
    chapter(
        "02",
        "D'où viennent les données ?",
        "Deux familles de données sont combinées : les données propres à l'utilisateur stockées "
        "dans MongoDB, et les constantes réglementaires locales du dépôt. La génération ne fait "
        "pas de recherche web en direct.",
    )
    table(
        ("Source", "Contenu", "Rôle dans le rapport"),
        (
            ("factures_emises", "Factures émises, lignes, HT, TTC, statut", "Justifier et ventiler les recettes"),
            ("virements", "Montant, sens, date, motif, référence, contrepartie", "Former le CA seulement après rapprochement"),
            ("contracts", "Type, dates, parties, montant, échéancier", "Contexte : revenu engagé, jamais encaissé"),
            ("invoices", "Factures de dépenses capturées et converties en EUR", "Information de marge ; non déductible en micro"),
            ("profil onboarding", "Catégorie, foyer, RFR N-2, ACRE, caisse, localisation", "Préremplir le contexte fiscal corrigeable"),
            ("seuils.yaml", "Abattements, plafonds, cotisations, TVA, VFL", "Source de vérité des taux et seuils"),
            ("impot_revenu.yaml", "Barème, quotient, décote, CFP, ACRE", "Compléter les règles de calcul de l'IR"),
        ),
        (38, 67, 73),
    )
    callout(
        "Ce qui n'entre pas dans l'assiette",
        "Les contrats signés ne sont pas des recettes. Les factures non payées ne sont pas "
        "encaissées. Les dépenses ne se déduisent pas au réel en micro-entreprise. Les salaires "
        "sont exclus du CA et doivent être traités séparément dans le revenu du foyer.",
        kind="warning",
    )
    heading("Autorité de la correction utilisateur")
    paragraph(
        "Le contexte issu de l'onboarding est un préremplissage. Avant de générer le rapport, "
        "l'utilisateur peut corriger ses parts fiscales, ses autres revenus, son RFR N-2, sa "
        "catégorie d'activité, sa caisse BNC, l'ACRE ou le versement libératoire. La valeur "
        "corrigée à l'écran devient l'entrée du moteur pour ce rapport."
    )

    # -------------------------------------------------------------- Chapter 3
    chapter(
        "03",
        "Comment le CA encaissé est construit",
        "Le rapprochement facture ↔ virement est la chaîne d'audit du rapport. Chaque euro retenu "
        "doit pouvoir être remonté à un virement et à une facture ayant une existence fiscale.",
    )
    heading("Filtres appliqués aux virements")
    bullets(
        [
            "La date d'opération (`execution_date`) détermine la période ; la date de valeur sert seulement de repli.",
            "Le montant doit être strictement positif et le sens doit être explicitement « reçu ».",
            "Un virement hors période est exclu mais conservé dans une liste visible avec son motif.",
            "Un virement sortant, ambigu ou sans facture correspondante est écarté sans être masqué.",
        ]
    )
    heading("Deux méthodes de rapprochement")
    table(
        ("Priorité", "Méthode", "Niveau de confiance", "Règle"),
        (
            ("1", "N° de facture", "Certain", "Le numéro FA/AV figure dans le motif ou la référence"),
            ("2", "Montant + date", "À confirmer", "Écart ≤ 0,02 €, candidat unique, fenêtre −1 à +120 jours"),
        ),
        (18, 39, 38, 83),
    )
    formula(
        "Conversion HT",
        "part HT = montant encaissé TTC × total HT facture / total TTC facture",
        "Si la facture est en franchise de TVA ou inexploitable, HT et encaissé coïncident.",
    )
    formula(
        "CA retenu",
        "CA encaissé HT = somme des parts HT rattachées pendant la période",
        "Un excédent au-delà du net à payer reste non affecté et déclenche une alerte.",
    )
    heading("Activité mixte")
    paragraph(
        "La nature dominante des lignes de facture détermine « vente » ou « prestation ». Les "
        "ventes sont envoyées au moteur en BIC_VENTE. Les prestations utilisent la catégorie par "
        "défaut corrigée par l'utilisateur : BIC_SERVICE ou BNC. Chaque catégorie conserve son "
        "propre abattement et son propre taux social."
    )

    # -------------------------------------------------------------- Chapter 4
    chapter(
        "04",
        "Le contexte nécessaire au calcul",
        "Le revenu de l'activité ne suffit pas à déterminer honnêtement l'impôt au barème. Le "
        "rapport sépare donc ce que la plateforme sait de ce que l'utilisateur doit déclarer.",
    )
    table(
        ("Champ", "Pourquoi il est utilisé", "Si absent"),
        (
            ("Parts fiscales", "Quotient familial", "IR au barème non calculé"),
            ("Autres revenus", "Comparer l'impôt du foyer avec/sans activité", "IR au barème non calculé"),
            ("RFR N-2", "Éligibilité au versement libératoire", "Éligibilité indéterminée"),
            ("Catégorie fiscale", "Abattement, social, CFP, plafond", "Repli profil, sinon BNC"),
            ("Caisse BNC", "Taux régime général ou CIPAV", "Régime général par défaut"),
            ("ACRE", "Réduction temporaire des cotisations", "Taux plein"),
            ("Jours d'activité", "Prorata du plafond en première année", "Plafond annuel plein"),
            ("DOM", "Détecter les règles non couvertes", "Métropole par défaut"),
        ),
        (41, 72, 65),
    )
    callout(
        "Calcul partiel assumé",
        "Si les parts fiscales ou les autres revenus manquent, la base imposable, les cotisations "
        "et la CFP restent calculées. Seul l'IR progressif est marqué « non calculé ». Ce n'est "
        "pas une panne : c'est une protection contre une fausse précision.",
        kind="info",
    )

    # -------------------------------------------------------------- Chapter 5
    chapter(
        "05",
        "Formules appliquées par le moteur",
        "Le moteur `app.agents.impots.moteur` est la seule autorité de calcul. L'orchestrateur "
        "prépare ses entrées et recopie sa sortie ; le PDF se contente ensuite de l'afficher.",
    )
    formula(
        "Abattement",
        "abattement = max(CA × taux, minimum), plafonné au CA",
        "Minimum : 305 € ; activité mixte : minimum configuré à 610 €. Base = CA − abattement.",
    )
    formula(
        "IR par tranche",
        "IR sur quotient = Σ [(borne − plancher) × taux]",
        "Le revenu net imposable est divisé par les parts puis l'impôt obtenu est remultiplié par les parts.",
    )
    formula(
        "IR imputable à la micro",
        "IR micro = IR du foyer avec activité − IR du foyer sans activité",
        "Après plafonnement de l'avantage des demi-parts puis application de la décote.",
    )
    formula(
        "Versement libératoire",
        "VFL = Σ (CA catégorie × taux VFL catégorie)",
        "Éligible si RFR N-2 ≤ 29 315 € × nombre de parts selon la table actuelle.",
    )
    formula(
        "Cotisations",
        "cotisations = Σ (CA catégorie × taux social catégorie)",
        "L'abattement fiscal ne réduit jamais l'assiette sociale. L'ACRE est appliquée ensuite.",
    )
    formula(
        "CFP",
        "CFP = Σ (CA catégorie × taux CFP catégorie)",
        "Contribution à la formation professionnelle, assise sur le CA plein.",
    )
    formula(
        "Synthèse",
        "total = IR retenu + cotisations + CFP  ;  net estimé = CA − total",
        "Le total et le net restent non calculés si aucune option d'IR ne peut être déterminée.",
    )

    # -------------------------------------------------------------- Chapter 6
    chapter(
        "06",
        "Paramètres 2026 utilisés actuellement",
        "Ce tableau décrit exactement les valeurs chargées par le code. Il ne constitue pas une "
        "validation juridique générale : le statut de vérification est détaillé au chapitre 10.",
    )
    table(
        ("Catégorie", "Abatt.", "Social", "CFP", "VFL", "Plafond micro", "TVA base / majoré"),
        (
            ("BIC vente", "71 %", "12,3 %", "0,1 %", "1 %", "203 100 €", "85 000 / 93 500 €"),
            ("BIC service", "50 %", "21,2 %", "0,3 %", "1,7 %", "83 600 €", "37 500 / 41 250 €"),
            ("BNC régime général", "34 %", "25,6 %", "0,2 %", "2,2 %", "83 600 €", "37 500 / 41 250 €"),
            ("BNC CIPAV", "34 %", "26,1 %", "0,2 %", "2,2 %", "83 600 €", "37 500 / 41 250 €"),
        ),
        (34, 19, 20, 17, 17, 34, 37),
    )
    heading("Barème IR 2026 sur les revenus 2025")
    table(
        ("Fraction du quotient", "Taux"),
        (
            ("Jusqu'à 11 600 €", "0 %"),
            ("De 11 600 € à 29 579 €", "11 %"),
            ("De 29 579 € à 84 577 €", "30 %"),
            ("De 84 577 € à 181 917 €", "41 %"),
            ("Au-delà de 181 917 €", "45 %"),
        ),
        (138, 40),
    )
    bullets(
        [
            "Plafond de l'avantage par demi-part supplémentaire : 1 807 €.",
            "Décote : max(0 ; 897 € − 45,25 % × IR) pour une personne seule.",
            "Décote couple configurée : max(0 ; 1 486 € − 45,25 % × IR), marquée à vérifier.",
            "Abattement minimum : 305 € ; 610 € selon la table d'activité mixte.",
        ]
    )
    callout(
        "Attention aux tables non recoupées",
        "`data/impot_revenu.yaml` porte encore `verifie: false`. Le moteur affiche donc un "
        "avertissement sur le barème, le quotient familial, la décote et la CFP, même lorsque "
        "certaines valeurs ont été retrouvées dans une source officielle lors de la rédaction de ce guide.",
        kind="danger",
    )

    # -------------------------------------------------------------- Chapter 7
    chapter(
        "07",
        "Plafonds, TVA, ACRE et cas particuliers",
        "Ces contrôles produisent des indicateurs et des alertes. Ils ne transforment pas le "
        "rapport en déclaration ni en liquidation complète de toutes les taxes.",
    )
    heading("Plafonds du régime micro")
    bullets(
        [
            "Le plafond est comparé par catégorie au CA encaissé transmis au moteur.",
            "En première année : plafond applicable = plafond annuel × jours d'activité / 365.",
            "Un dépassement isolé est signalé mais ne provoque pas automatiquement une sortie : deux années consécutives sont nécessaires.",
            "Le rapport n'a pas l'historique fiscal complet pour conclure seul à la sortie du régime.",
        ]
    )
    heading("Franchise en base de TVA")
    paragraph(
        "Le module TVA compare le CA par nature aux seuils de base et majorés. Il affiche un "
        "drapeau de vigilance, mais ne calcule aucune TVA collectée, déductible ou nette. Une "
        "période couvrant toute l'année civile est nécessaire pour interpréter correctement les "
        "seuils annuels. La TVA collectée est toujours exclue du chiffre d'affaires."
    )
    heading("ACRE")
    paragraph(
        "La table actuelle applique un facteur de 50 % au total des cotisations lorsque l'ACRE "
        "est active. Le rapport signale explicitement que cette approximation touche aussi la "
        "CSG-CRDS alors que celle-ci reste due. La durée configurée est de quatre trimestres "
        "civils ; la date de début du profil permet d'indiquer l'expiration."
    )
    callout(
        "Validation requise avant production",
        "Les modalités ACRE 2026 et le taux BNC CIPAV de la table doivent être recoupés avec la "
        "situation exacte de l'utilisateur et la documentation URSSAF à jour. Le guide décrit le "
        "moteur actuel ; il ne transforme pas une valeur `verifie: false` en règle certifiée.",
        kind="danger",
    )
    heading("DOM")
    paragraph(
        "Les taux sociaux minorés et la réfaction d'impôt propres aux DOM ne figurent pas dans la "
        "table. Si le profil indique un DOM, le rapport utilise encore les taux métropolitains et "
        "affiche une alerte critique indiquant que les cotisations peuvent être surestimées."
    )

    # -------------------------------------------------------------- Chapter 8
    example = simuler_impots(
        activites=[{"categorie": "BNC", "ca": 30_000}],
        parts_fiscales=1,
        autres_revenus=0,
        en_couple=False,
        rfr_n2=20_000,
        caisse_bnc="REGIME_GENERAL",
        acre_active=False,
        option_versement_liberatoire=False,
    )
    line = example["lignes"][0]
    vl = example["versement_liberatoire"]
    chapter(
        "08",
        "Exemple calculé par le moteur",
        "Hypothèse pédagogique : 30 000 € de CA encaissé HT en BNC, régime général, une part, "
        "aucun autre revenu, RFR N-2 de 20 000 €, sans ACRE et sans option VFL activée.",
    )
    table(
        ("Étape", "Calcul", "Résultat moteur"),
        (
            ("Abattement", "30 000 × 34 %", f"{line['abattement']:,.2f} €".replace(",", " ")),
            ("Base imposable", "30 000 − 10 200", f"{line['base_imposable']:,.2f} €".replace(",", " ")),
            ("IR avant décote", "Tranche à 11 %", f"{example['detail_avec_micro']['impot_avant_plafonnement']:,.2f} €".replace(",", " ")),
            ("Décote", "897 − 45,25 % × IR", f"{example['detail_avec_micro']['decote']:,.2f} €".replace(",", " ")),
            ("IR imputable", "IR avec micro − IR sans micro", f"{example['ir_bareme']:,.2f} €".replace(",", " ")),
            ("Cotisations", "30 000 × 25,6 %", f"{example['cotisations_sociales']:,.2f} €".replace(",", " ")),
            ("CFP", "30 000 × 0,2 %", f"{example['cfp']:,.2f} €".replace(",", " ")),
            ("VFL comparable", "30 000 × 2,2 %", f"{vl['montant']:,.2f} €".replace(",", " ")),
            ("Total retenu", "IR + social + CFP", f"{example['total_prelevements']:,.2f} €".replace(",", " ")),
            ("Net estimé", "CA − total", f"{example['revenu_net_estime']:,.2f} €".replace(",", " ")),
        ),
        (38, 75, 65),
    )
    callout(
        "Pourquoi 8 153,15 € et non 8 153,16 € ?",
        "Le moteur additionne les valeurs en pleine précision puis arrondit le résultat final. "
        "Additionner les trois montants déjà arrondis à l'écran peut créer un écart d'un centime. "
        "Cette différence est attendue et évite l'accumulation d'arrondis intermédiaires.",
        kind="info",
    )
    paragraph(
        "Dans cet exemple, le moteur recommande le barème parce que l'IR imputable de 413,16 € "
        "est inférieur au VFL de 660 €. La recommandation dépend du foyer : elle ne peut pas être "
        "généralisée à un autre utilisateur."
    )

    # -------------------------------------------------------------- Chapter 9
    chapter(
        "09",
        "Ce que contient le rapport généré",
        "Le résultat JSON et le PDF sont structurés pour être contrôlables. L'export n'est pas un "
        "résumé opaque : il expose l'assiette, le calcul, les anomalies et la provenance.",
    )
    bullets(
        [
            "Période, date de génération et chiffre d'affaires encaissé retenu.",
            "CA facturé sur la période comme indicateur distinct, sans effet sur l'impôt.",
            "Liste des encaissements, méthode de rattachement et niveau de certitude.",
            "Virements exclus, factures impayées ou partielles, écarts et virements hors période.",
            "Ventilation BIC vente / BIC service / BNC et détail des abattements.",
            "IR au barème, versement libératoire, cotisations, CFP, total et net estimé.",
            "État TVA, plafonds micro, prorata de première année et statut ACRE.",
            "Contrats et dépenses à titre informatif, avec alertes explicatives.",
            "Constantes effectivement appliquées, année, fichier et date de vérification.",
        ]
    )
    heading("Cycle API et archivage")
    table(
        ("Opération", "Endpoint", "Effet"),
        (
            ("Préremplir", "GET /api/rapport-fiscal/contexte", "Retourne profil, origine des champs et manquants"),
            ("Générer", "POST /api/rapport-fiscal", "Calcule puis archive si `enregistrer=true`"),
            ("Lister", "GET /api/rapport-fiscal", "Liste les instantanés de l'utilisateur"),
            ("Consulter", "GET /api/rapport-fiscal/{id}", "Retourne l'instantané archivé"),
            ("Exporter", "GET /api/rapport-fiscal/{id}/pdf", "Rend le PDF sans recalcul"),
        ),
        (32, 68, 78),
    )
    callout(
        "Pourquoi archiver ?",
        "Une correction ultérieure de facture ou de virement peut modifier un nouveau calcul. "
        "Le rapport archivé conserve les chiffres, rapprochements et hypothèses tels qu'ils "
        "étaient au jour de sa génération.",
        kind="success",
    )

    # ------------------------------------------------------------- Chapter 10
    chapter(
        "10",
        "Sources officielles et statut de vérification",
        "Les URLs ci-dessous sont les références déclarées par le projet et contrôlées pour ce "
        "guide. Les valeurs restent gouvernées par les fichiers YAML : une revue doit mettre à "
        "jour à la fois la valeur, l'année, la date et le drapeau de vérification.",
    )
    source_link(
        "Seuils du régime micro et règle des deux années",
        "https://entreprendre.service-public.gouv.fr/vosdroits/F32353",
        "Source officielle Service-Public Entreprendre — cohérente avec les plafonds 2026 du projet",
    )
    source_link(
        "Régime micro et abattements BIC/BNC",
        "https://entreprendre.service-public.gouv.fr/vosdroits/F23267",
        "Source officielle — abattements 71 %, 50 % et 34 %, minimum BNC de 305 €",
    )
    source_link(
        "Taux BNC régime général 2026",
        "https://www.urssaf.fr/accueil/actualites/taux-cotisations-autoentrepeneur.html",
        "Source URSSAF — confirme 25,6 % à partir du 1er janvier 2026",
    )
    source_link(
        "Versement libératoire",
        "https://www.economie.gouv.fr/entreprises/gerer-sa-micro-entreprise/micro-entreprise-comment-fonctionne-le-versement-liberatoire-de-limpot-sur-le-revenu",
        "Source ministère de l'Économie — taux 1 %, 1,7 % et 2,2 %, condition de RFR N-2",
    )
    source_link(
        "Barème progressif 2026 sur revenus 2025",
        "https://www.impots.gouv.fr/particulier/questions/comment-calculer-mon-taux-dimposition-dapres-le-bareme-progressif-de-limpot",
        "Source DGFiP — tranches 0 %, 11 %, 30 %, 41 % et 45 %",
    )
    source_link(
        "Franchise en base de TVA",
        "https://www.impots.gouv.fr/professionnel/questions/en-tant-que-micro-entrepreneur-puis-je-etre-redevable-de-la-tva",
        "Source DGFiP — seuils et conséquence du dépassement majoré",
    )
    source_link(
        "ACRE",
        "https://www.urssaf.fr/accueil/independant/creer-entreprise/beneficier-exoneration-acre.html",
        "Source URSSAF — à recouper avec la date de création et la catégorie exacte",
    )
    heading("État des fichiers internes")
    table(
        ("Fichier", "Version", "Statut porté par le dépôt"),
        (
            ("data/seuils.yaml", "2026 · vérifié 23/07/2026", "Valeurs datées ; pas de booléen global `verifie`"),
            ("data/impot_revenu.yaml", "2026 · daté 03/08/2026", "`verifie: false` — avertissement obligatoire"),
            ("data/declarations.yaml", "2026 · daté 04/08/2026", "Statut par bloc ; plusieurs valeurs non recoupées"),
        ),
        (55, 54, 69),
    )

    # ------------------------------------------------------------- Chapter 11
    chapter(
        "11",
        "Limites et vérifications avant utilisation",
        "Le rapport est un outil de préparation. Sa qualité dépend autant des pièces fournies et "
        "des corrections utilisateur que de l'actualité des tables réglementaires.",
    )
    callout(
        "À vérifier avant toute déclaration",
        "Confirmez chaque rapprochement marqué « à confirmer », les virements exclus, la période, "
        "la catégorie fiscale, le foyer, l'ACRE, la caisse BNC et les règles 2026 sur les sites "
        "officiels. Un expert-comptable reste recommandé pour une situation complexe.",
        kind="danger",
    )
    heading("Limites fonctionnelles")
    bullets(
        [
            "Le rapport couvre le moteur micro-entreprise ; il ne calcule pas l'IS d'une société ni un régime réel complet.",
            "Il ne liquide pas la TVA et ne calcule pas la CFE, dont le montant dépend notamment de la commune.",
            "Il ne transmet ni déclaration, ni paiement à l'URSSAF ou à la DGFiP.",
            "Il ne conclut pas seul à la sortie du régime micro faute d'historique certifié sur deux années.",
            "Les cas DOM ne disposent pas encore des taux spécifiques dans la table.",
            "Un document OCR mal lu doit être corrigé ; la donnée corrigée par l'utilisateur fait foi.",
            "Une absence de facture empêche le virement d'entrer automatiquement dans le CA du rapport.",
            "Les contrats et dépenses apportent du contexte, mais ne modifient pas l'assiette micro.",
        ]
    )
    heading("Checklist utilisateur")
    table(
        ("OK", "Contrôle à effectuer"),
        (
            ("□", "La période correspond exactement à la déclaration préparée."),
            ("□", "Chaque virement reçu possède une facture et une référence cohérente."),
            ("□", "Les rapprochements par montant/date ont été confirmés."),
            ("□", "Les parts, autres revenus et RFR N-2 sont à jour."),
            ("□", "La catégorie BIC/BNC et la caisse BNC sont correctes."),
            ("□", "Le statut et les dates ACRE ont été vérifiés."),
            ("□", "Les seuils et taux ont été contrôlés sur les sources officielles."),
            ("□", "Le PDF a été relu avant toute utilisation déclarative."),
        ),
        (16, 162),
    )
    callout(
        "Transparence IA",
        "LedgerMind a été conçu et développé avec l'aide de l'intelligence artificielle. Le "
        "rapport fiscal, lui, est calculé par un moteur déterministe : l'IA ne choisit ni les "
        "taux ni les formules. Les contenus explicatifs peuvent nécessiter une vérification humaine.",
        kind="info",
    )

    return bytes(pdf.output())


def main() -> None:
    parser = argparse.ArgumentParser(description="Génère le guide PDF du rapport fiscal LedgerMind.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.out.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(build_pdf())
    print(f"Guide généré : {output}")
    print(f"Taille : {output.stat().st_size:,} octets")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
