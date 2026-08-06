"""Génère la note explicative des calculs fiscaux, en PDF.

Le document est produit DEPUIS le moteur : chaque taux, seuil et barème y est lu à
l'exécution, jamais recopié à la main. Une note recopiée dérive de son code au premier
changement de loi de finances — celle-ci ne le peut pas.

    python -m scripts.generer_doc_calculs [chemin.pdf]

Ce qu'il documente, dans l'ordre du calcul réel :
  la chaîne des données → l'assiette → les formules du moteur → les déclarations produites,
  puis ce que la plateforme refuse de faire, et les valeurs restant à recouper.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from app.agents.facture.pdf import (
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
from app.agents.impots import constantes as C
from app.agents.impots import tools as moteur

ALERTE_INK = (150, 42, 42)
ALERTE_BG = (252, 238, 238)
VERT_INK = (30, 105, 70)
VERT_BG = (233, 246, 239)


def _eur(n: Optional[float]) -> str:
    if n is None:
        return "—"
    return f"{n:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _eur0(n: Optional[float]) -> str:
    if n is None:
        return "—"
    return f"{n:,.0f}".replace(",", " ") + " €"


def _pct(taux: Optional[float]) -> str:
    """Un taux de 0,044 % ne doit jamais s'afficher « 0 % »."""
    if taux is None:
        return "—"
    valeur = taux * 100
    decimales = 0 if abs(valeur - round(valeur)) < 0.005 else (1 if valeur >= 1 else 3)
    return f"{valeur:.{decimales}f} %".replace(".", ",")


def _tronquer(texte: str, limite: int) -> str:
    """Coupe au dernier mot entier — une troncature en plein mot rend le libellé illisible."""
    if len(texte) <= limite:
        return texte
    coupe = texte[:limite].rsplit(" ", 1)[0]
    return f"{coupe}…"


def _fr_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    p = str(iso)[:10].split("-")
    return f"{p[2]}/{p[1]}/{p[0]}" if len(p) == 3 else str(iso)


class _Doc:
    """Petite couche de mise en page — le contenu reste lisible dans `construire()`."""

    def __init__(self) -> None:
        from fpdf import FPDF

        note = self

        class Page(FPDF):
            def footer(self) -> None:  # noqa: D102 — contrat fpdf2
                self.set_y(-14)
                self.set_font(note.police, "", 7)
                self.set_text_color(*MUTED)
                self.cell(
                    0, 4,
                    note.t("LedgerMind — note explicative des calculs fiscaux"), align="L",
                )
                self.set_y(-14)
                self.cell(0, 4, note.t(f"page {self.page_no()}"), align="R")

        self.pdf = Page(format="A4", unit="mm")
        self.pdf.set_auto_page_break(auto=True, margin=20)
        self.pdf.add_page()
        self.pdf.set_margins(18, 16, 18)
        self.police, self.unicode_ok = _setup_font(self.pdf)

    def t(self, s: str) -> str:
        s = s or ""
        if self.unicode_ok:
            return s
        for k, v in _LATIN1_REPL.items():
            s = s.replace(k, v)
        return s.encode("latin-1", "replace").decode("latin-1")

    # -- blocs ---------------------------------------------------------------
    def couverture(self, titre: str, sous_titre: str) -> None:
        self.pdf.set_fill_color(*NAVY)
        self.pdf.rect(0, 0, 210, 62, style="F")
        self.pdf.set_xy(18, 18)
        self.pdf.set_text_color(*CREME)
        self.pdf.set_font(self.police, "B", 22)
        self.pdf.multi_cell(174, 10, self.t(titre))
        self.pdf.set_x(18)
        self.pdf.set_font(self.police, "", 10.5)
        self.pdf.multi_cell(174, 5.5, self.t(sous_titre))
        self.pdf.set_y(70)
        self.pdf.set_text_color(*INK)

    def titre1(self, texte: str) -> None:
        if self.pdf.get_y() > 235:
            self.pdf.add_page()
        self.pdf.ln(5)
        self.pdf.set_text_color(*NAVY)
        self.pdf.set_font(self.police, "B", 14)
        self.pdf.multi_cell(174, 7, self.t(texte))
        self.pdf.set_draw_color(*NAVY)
        self.pdf.set_line_width(0.5)
        self.pdf.line(18, self.pdf.get_y() + 1, 192, self.pdf.get_y() + 1)
        self.pdf.set_line_width(0.2)
        self.pdf.ln(4)
        self.pdf.set_text_color(*INK)

    def titre2(self, texte: str) -> None:
        if self.pdf.get_y() > 250:
            self.pdf.add_page()
        self.pdf.ln(3)
        self.pdf.set_text_color(*NAVY)
        self.pdf.set_font(self.police, "B", 10.5)
        self.pdf.multi_cell(174, 5.5, self.t(texte))
        self.pdf.ln(1)
        self.pdf.set_text_color(*INK)

    def p(self, texte: str, taille: float = 9) -> None:
        self.pdf.set_font(self.police, "", taille)
        self.pdf.set_text_color(*INK)
        self.pdf.multi_cell(174, 4.8, self.t(texte))
        self.pdf.ln(1.5)

    def puces(self, items: Sequence[str]) -> None:
        self.pdf.set_font(self.police, "", 9)
        self.pdf.set_text_color(*INK)
        for item in items:
            if self.pdf.get_y() > 262:
                self.pdf.add_page()
            self.pdf.set_x(22)
            self.pdf.multi_cell(170, 4.8, self.t(f"•  {item}"))
        self.pdf.ln(1.5)

    # Courier est une police de base, limitée au latin-1 : symboles mathématiques ET signe
    # euro y lèveraient une exception. On les transpose plutôt que d'appauvrir le texte source.
    _MONOSPACE = {
        "Σ": "somme", "≤": "<=", "≥": ">=", "−": "-", "→": "->", "×": "x",
        "€": "EUR", "’": "'", "…": "...", "—": "--", " ": " ", " ": " ",
    }

    def formule(self, lignes: Sequence[str]) -> None:
        """Bloc de formule — police fixe, fond gris, pour se distinguer du texte."""
        hauteur = len(lignes) * 4.6 + 4
        if self.pdf.get_y() + hauteur > 268:
            self.pdf.add_page()
        y = self.pdf.get_y()
        self.pdf.set_fill_color(245, 247, 250)
        self.pdf.rect(18, y, 174, hauteur, style="F")
        self.pdf.set_xy(22, y + 2)
        self.pdf.set_font("Courier", "", 8.5)
        self.pdf.set_text_color(*INK)
        for ligne in lignes:
            for symbole, remplacement in self._MONOSPACE.items():
                ligne = ligne.replace(symbole, remplacement)
            self.pdf.set_x(22)
            self.pdf.cell(166, 4.6, ligne.encode("latin-1", "replace").decode("latin-1"), ln=1)
        self.pdf.set_y(y + hauteur + 2)

    def tableau(self, entetes: Sequence[str], largeurs: Sequence[float],
                lignes: Sequence[Sequence[str]], alignements: Sequence[str] | None = None) -> None:
        alignements = alignements or ["L"] * len(entetes)

        def en_tete() -> None:
            self.pdf.set_fill_color(*NAVY_BG)
            self.pdf.set_text_color(*NAVY)
            self.pdf.set_font(self.police, "B", 8)
            self.pdf.set_x(18)
            for largeur, entete, align in zip(largeurs, entetes, alignements):
                self.pdf.cell(largeur, 6.2, self.t(entete), fill=True, align=align)
            self.pdf.ln(6.2)
            self.pdf.set_text_color(*INK)
            self.pdf.set_font(self.police, "", 8)

        if self.pdf.get_y() > 250:
            self.pdf.add_page()
        en_tete()
        for ligne in lignes:
            if self.pdf.get_y() > 262:
                self.pdf.add_page()
                en_tete()
            self.pdf.set_x(18)
            for largeur, valeur, align in zip(largeurs, ligne, alignements):
                self.pdf.cell(largeur, 5.4, self.t(str(valeur)), align=align)
            self.pdf.ln(5.4)
            self.pdf.set_draw_color(*BORDER)
            self.pdf.line(18, self.pdf.get_y(), 192, self.pdf.get_y())
        self.pdf.ln(2.5)

    def encadre(self, titre: str, message: str, encre=BUTTER_INK, fond=BUTTER_BG) -> None:
        if self.pdf.get_y() > 240:
            self.pdf.add_page()
        self.pdf.set_fill_color(*fond)
        self.pdf.set_draw_color(*fond)
        self.pdf.set_x(18)
        self.pdf.set_text_color(*encre)
        if titre:
            self.pdf.set_font(self.police, "B", 9)
            self.pdf.multi_cell(174, 5, self.t(titre), fill=True)
            self.pdf.set_x(18)
        self.pdf.set_font(self.police, "", 8.5)
        self.pdf.multi_cell(174, 4.4, self.t(message), fill=True)
        self.pdf.set_text_color(*INK)
        self.pdf.ln(3)

    def octets(self) -> bytes:
        return bytes(self.pdf.output())


# ============================================================================
def construire() -> bytes:
    d = _Doc()
    K = moteur.constantes_fiscales()
    provenance = K["provenance"]
    decl = C.declarations()

    d.couverture(
        "Comment vos impôts sont calculés",
        "Note explicative — de vos justificatifs au montant à déclarer.\n"
        f"Barèmes {provenance['seuils']['annee']} · document généré le "
        f"{_fr_date(date.today().isoformat())}",
    )

    d.p(
        "Cette note décrit la totalité du chemin suivi par la plateforme : quelles pièces sont "
        "lues, comment l'assiette imposable est construite, quelles formules s'appliquent, et "
        "ce qui est produit au bout. Elle est générée depuis le moteur de calcul lui-même — les "
        "taux et barèmes ci-dessous sont ceux réellement appliqués, pas une recopie.",
        taille=9.5,
    )
    d.encadre(
        "Ce que ce document n'est pas",
        "Ni un conseil fiscal, ni une déclaration. Il explique une mécanique de calcul pour "
        "que vous puissiez la vérifier — et la contester si elle se trompe.",
    )

    # ---------------------------------------------------------------- 1
    d.titre1("1.  D'où viennent les chiffres")
    d.p(
        "Six sources alimentent le calcul. Elles n'ont pas le même rôle, et les confondre "
        "produirait un montant faux sans que rien ne le signale."
    )
    d.tableau(
        ["Source", "Ce qu'elle apporte", "Entre dans l'assiette ?"],
        [46, 86, 42],
        [
            ["Virements reçus", "les encaissements réels", "OUI, une fois rapprochés"],
            ["Cadeaux reçus", "avantages en nature", "OUI, à leur valeur marchande"],
            ["Factures émises", "ce qui est dû, et la TVA collectée", "non"],
            ["Factures reçues", "la TVA déductible", "non (voir §6)"],
            ["Contrats", "revenu engagé, cohérence", "JAMAIS"],
            ["Profil d'onboarding", "vos paramètres de calcul", "non"],
        ],
    )
    d.titre2("Pourquoi un contrat ne compte pas")
    d.p(
        "Un contrat engage, il n'encaisse pas. Un contrat de 24 000 € signé en janvier ne "
        "devient du chiffre d'affaires qu'au fil des virements reçus. L'y inclure d'emblée "
        "ferait payer des cotisations sur de l'argent jamais perçu."
    )
    d.titre2("Pourquoi une dépense ne réduit rien")
    d.p(
        "En micro-entreprise, l'abattement forfaitaire REMPLACE la déduction des frais réels. "
        "Vos achats professionnels sont affichés pour mesurer votre marge, mais les déduire de "
        "l'assiette appliquerait deux fois le même avantage."
    )

    # ---------------------------------------------------------------- 2
    d.titre1("2.  L'assiette : le chiffre d'affaires ENCAISSÉ")
    d.encadre(
        "La règle qui commande tout",
        "L'impôt et les cotisations d'une micro-entreprise portent sur l'argent REÇU, pas sur "
        "l'argent facturé. Une facture émise et non payée ne compte pas pour la période : elle "
        "comptera pour celle de son encaissement.",
        encre=VERT_INK, fond=VERT_BG,
    )
    d.formule([
        "CA encaissé = Σ (virements reçus rapprochés, convertis en HT)",
        "            + Σ (avantages en nature, à leur valeur marchande retenue)",
    ])
    d.titre2("Comment un virement est rattaché à une facture")
    d.puces([
        "Le numéro de facture figure dans le libellé → rattachement CERTAIN.",
        "Le montant et la date concordent, et une seule facture convient → À CONFIRMER : "
        "compté, mais signalé.",
        "Plusieurs factures du même montant conviennent → NON rattaché. Deviner rattacherait "
        "le mauvais encaissement.",
        "Le sens de l'opération n'est pas « reçu » → écarté. Un virement sortant gonflerait le "
        "chiffre d'affaires, donc l'impôt.",
    ])
    d.titre2("La TVA collectée n'est pas un revenu")
    d.p(
        "Le client règle un montant TTC, mais l'assiette est le HT : la TVA transite, elle ne "
        "vous appartient pas. Sous franchise en base les deux montants coïncident, ce qui rend "
        "l'erreur invisible — d'où une conversion explicite."
    )
    d.formule([
        "part HT = montant reçu × (total HT de la facture / total TTC de la facture)",
    ])
    d.titre2("Les cadeaux sont du chiffre d'affaires")
    d.p(
        "Un cadeau reçu en contrepartie d'un service n'est pas fiscalement un cadeau : c'est un "
        "partenariat rémunéré en produits, donc un revenu en nature. Il se déclare à sa valeur "
        "marchande et entre dans l'assiette — alors qu'aucun euro n'a transité par votre compte. "
        "Seule la valeur que VOUS retenez est comptée : une estimation par photo reste une "
        "suggestion."
    )

    # ---------------------------------------------------------------- 3
    d.titre1("3.  Les taux appliqués")
    d.p(
        "Aucun de ces chiffres n'est écrit dans le code : ils vivent dans des fichiers de "
        "données datés et sourcés, et sont relus à chaque calcul."
    )
    lignes = []
    for cle, libelle in [
        ("BIC_VENTE", "Vente de marchandises"),
        ("BIC_SERVICE", "Prestations de services (BIC)"),
        ("BNC", "Professions libérales (BNC)"),
    ]:
        lignes.append([
            libelle,
            _pct(K["abattements"][cle]),
            _pct(
                K["taux_sociaux"]["BNC_REGIME_GENERAL"] if cle == "BNC"
                else K["taux_sociaux"][cle]
            ),
            _pct(decl["tfcc"][cle]["taux"]),
            _pct(K["versement_liberatoire"][cle]),
            _eur0(K["plafonds_ca"][cle]),
        ])
    d.tableau(
        ["Catégorie", "Abattement", "Cotisations", "TFCC", "Vers. lib.", "Plafond CA"],
        [50, 24, 24, 22, 24, 30],
        lignes,
        ["L", "R", "R", "R", "R", "R"],
    )
    d.puces([
        f"BNC affilié à la Cipav : cotisations de "
        f"{_pct(K['taux_sociaux']['BNC_CIPAV'])} au lieu de "
        f"{_pct(K['taux_sociaux']['BNC_REGIME_GENERAL'])}.",
        f"Abattement plancher : {_eur(C.abattement_minimum())} — doublé à "
        f"{_eur(C.abattement_minimum_mixte())} en activité mixte.",
        "TFCC : due par les seuls BIC. Un BNC n'est inscrit qu'au RNE, jamais au RCS.",
    ])

    d.titre2("Barème de l'impôt sur le revenu, par part")
    d.tableau(
        ["Tranche", "De", "À", "Taux"],
        [30, 48, 48, 48],
        [
            [str(i + 1), _eur0(t.get("plancher", 0)),
             _eur0(t["plafond"]) if t.get("plafond") else "au-delà", _pct(t["taux"])]
            for i, t in enumerate(K["bareme_ir"])
        ],
        ["L", "R", "R", "R"],
    )

    # ---------------------------------------------------------------- 4
    d.titre1("4.  Le calcul, étape par étape")

    d.titre2("Étape 1 — Base imposable")
    d.p(
        "L'abattement forfaitaire représente vos charges, de façon forfaitaire. Il est calculé "
        "par catégorie : agréger une vente et une prestation appliquerait un seul taux à deux "
        "réalités différentes."
    )
    d.formule([
        "abattement      = max(CA × taux_abattement, plancher)",
        "base_imposable  = CA − abattement",
    ])

    d.titre2("Étape 2 — Cotisations sociales")
    d.p(
        "Elles portent sur le CA PLEIN. L'abattement est fiscal : il ne réduit pas l'assiette "
        "sociale. C'est l'erreur la plus fréquente sur ce calcul."
    )
    d.formule([
        "cotisations = CA × taux_social[catégorie]",
        f"si ACRE actif : cotisations × {C.acre()['reduction']}"
        f"   (les {C.acre()['trimestres_civils']} premiers trimestres civils)",
    ])

    d.titre2("Étape 3 — Contribution à la formation, et taxe consulaire")
    d.formule([
        "CFP  = CA × taux_CFP[catégorie]",
        f"       nulle si 1re année ET CA annuel < "
        f"{_eur0(C.seuil_cfp_premiere_annee())}  (les DEUX conditions)",
        "TFCC = CA × taux_TFCC[catégorie]        (BIC uniquement)",
    ])

    d.titre2("Étape 4 — Impôt sur le revenu au barème")
    d.p(
        "Le barème est progressif et porte sur l'ENSEMBLE des revenus du foyer : sans le nombre "
        "de parts et vos autres revenus, aucun montant honnête ne peut être produit. Dans ce "
        "cas la plateforme refuse de calculer plutôt que de supposer un foyer type."
    )
    d.formule([
        "Q             = revenu net imposable du foyer / nombre de parts",
        "IR brut       = barème(Q) × nombre de parts",
        "",
        "# plafonnement de l'avantage des demi-parts supplémentaires",
        f"avantage max  = {_eur0(K['quotient_familial']['plafond_demi_part'])}"
        " × nombre de demi-parts en plus",
        "IR après plaf = max(IR brut, IR sans les demi-parts − avantage max)",
        "",
        "# décote, pour les impôts modestes",
        f"décote        = max(0, D − {K['decote']['taux']} × IR après plaf)",
        f"                D = {_eur0(K['decote']['celibataire'])} seul, "
        f"{_eur0(K['decote']['couple'])} en couple",
        "IR net        = max(0, IR après plaf − décote)",
    ])
    d.titre2("La part d'impôt réellement due à votre activité")
    d.p(
        "On ne peut pas isoler l'impôt d'une activité en la calculant seule : le barème est "
        "progressif. On procède donc par différence — l'impôt du foyer AVEC votre activité, "
        "moins celui du même foyer SANS elle."
    )
    d.formule([
        "IR imputé = IR net(autres revenus + base imposable)",
        "          − IR net(autres revenus)",
    ])

    d.titre2("Étape 5 — Ou le versement libératoire, si vous l'avez choisi")
    d.p(
        "Option alternative au barème : un pourcentage fixe du chiffre d'affaires, prélevé en "
        "même temps que les cotisations. Elle suppose un revenu fiscal de référence N-2 sous "
        "un plafond."
    )
    d.formule([
        "IR versement libératoire = CA × taux_VL[catégorie]",
        "",
        f"éligible si RFR N-2 ≤ {_eur0(K['versement_liberatoire']['rfr_max_par_part'])}"
        " × nombre de parts",
    ])
    d.p(
        "Les deux options sont chiffrées côte à côte, et la moins coûteuse est nommée. Sans "
        "votre RFR N-2, l'éligibilité reste indéterminée et la comparaison ne conclut pas."
    )

    d.titre2("Étape 6 — Totaux")
    d.formule([
        "total prélèvements = IR retenu + cotisations + CFP + TFCC",
        "revenu net estimé  = CA − total prélèvements",
        "taux effectif      = total prélèvements / CA      (non applicable si CA = 0)",
    ])

    # ---------------------------------------------------------------- 5
    d.titre1("5.  Les contrôles réglementaires")
    d.titre2("Plafond du régime micro")
    d.p(
        "Le CA est comparé au plafond de chaque catégorie. Un dépassement est SIGNALÉ, jamais "
        "conclu : la sortie du régime suppose deux années consécutives au-dessus du seuil, "
        "information hors de portée d'un calcul sur une seule période."
    )
    d.formule([
        "plafond proratisé = plafond × (jours d'activité / 365)",
        "                    — première année seulement, et sur le PLAFOND uniquement :",
        "                      les taux, eux, restent inchangés.",
    ])

    d.titre2("Franchise en base de TVA")
    tva = C.declarations() and None  # les seuils vivent dans seuils.yaml
    from app.agents.rapport_fiscal.tva import seuils_tva

    bloc_tva = seuils_tva()
    d.tableau(
        ["Nature", "Seuil de base", "Seuil majoré"],
        [70, 52, 52],
        [
            ["Prestations de services",
             _eur0(bloc_tva["services"]["seuil_base"]),
             _eur0(bloc_tva["services"]["seuil_majore"])],
            ["Vente de marchandises",
             _eur0(bloc_tva["vente"]["seuil_base"]),
             _eur0(bloc_tva["vente"]["seuil_majore"])],
        ],
        ["L", "R", "R"],
    )
    d.puces([
        "Seuil de base franchi → assujettissement au 1er janvier de l'année suivante.",
        "Seuil majoré franchi → assujettissement dès le 1er jour du mois de dépassement, "
        "donc rétroactivement sur des factures déjà émises sans TVA.",
        "La plateforme SIGNALE la position ; elle ne liquide aucune TVA et ne bascule jamais "
        "seule un régime.",
    ])

    # ---------------------------------------------------------------- 6
    d.titre1("6.  Ce qui est produit au bout")
    d.p(
        "Cinq déclarations, chacune sur des périodes imposées par la réglementation et par la "
        "périodicité déclarée à la création — jamais choisies dans l'écran."
    )
    d.tableau(
        ["Déclaration", "Formulaire", "Périodicité", "Due à 0 € ?"],
        [58, 40, 40, 36],
        [
            ["Chiffre d'affaires", "téléservice URSSAF", "mensuelle / trim.", "OUI"],
            ["Revenus annuels", "2042-C-PRO", "annuelle", "OUI"],
            ["Services européens", "DES (Prodouane)", "mensuelle", "non"],
            ["TVA", "3310-CA3", "selon régime", "non"],
            ["Cotisation foncière", "— (1447-C-SD à la création)", "annuelle", "non"],
        ],
    )
    d.titre2("Les cases de la déclaration de revenus")
    cases = decl["declaration_revenus"]["cases"]
    d.tableau(
        ["Case", "Catégorie", "Montant à reporter"],
        [20, 108, 46],
        [[cases[c]["case"], _tronquer(cases[c]["libelle"], 60), "CA BRUT encaissé"]
         for c in ("BIC_VENTE", "BIC_SERVICE", "BNC")],
    )
    d.encadre(
        "Le point à ne jamais manquer",
        "Ces cases attendent le chiffre d'affaires BRUT. C'est l'administration qui applique "
        "l'abattement. Le déduire vous-même avant de remplir la case l'appliquerait DEUX FOIS, "
        "et minorerait votre déclaration.",
        encre=ALERTE_INK, fond=ALERTE_BG,
    )
    d.titre2("TVA : collectée, déductible, nette")
    d.formule([
        "TVA collectée  = Σ TVA réelle des factures émises de la période",
        "TVA déductible = Σ TVA des achats PROFESSIONNELS justifiés",
        "TVA nette due  = collectée − déductible      (négative = crédit de TVA)",
    ])
    d.p(
        "Le taux n'est jamais supposé : on lit la TVA réelle de chaque facture, une prestation "
        "pouvant porter 20 %, 10 % ou 5,5 %. Une facture dont la TVA n'a pas pu être lue est "
        "comptée à part et signalée — une TVA illisible n'est pas une TVA nulle."
    )

    # ---------------------------------------------------------------- 7
    d.titre1("7.  Ce que la plateforme refuse de faire")
    d.p(
        "Ces refus sont délibérés. Chacun évite une erreur qui ne se verrait pas dans le "
        "résultat."
    )
    d.tableau(
        ["Refus", "Ce qu'il évite"],
        [72, 102],
        [
            ["Calculer l'IR sans votre foyer",
             "un montant inventé, présenté comme sûr"],
            ["Déduire l'abattement avant une case",
             "l'appliquer deux fois, et minorer la déclaration"],
            ["Inventer un numéro de case",
             "une référence fausse sur un document officiel"],
            ["Compter un virement sortant",
             "gonfler le CA, donc l'impôt et les cotisations"],
            ["Trancher entre deux factures identiques",
             "rattacher le mauvais encaissement"],
            ["Déduire vos dépenses",
             "cumuler l'abattement et les frais réels"],
            ["Basculer seul un régime de TVA",
             "facturer sans TVA alors qu'elle est due — ou l'inverse"],
            ["Transmettre une déclaration",
             "engager votre responsabilité à votre place"],
        ],
    )

    # ---------------------------------------------------------------- 8
    d.titre1("8.  Provenance et fraîcheur des chiffres")
    d.p(
        "Chaque valeur porte sa source et sa date de contrôle. Celles marquées « non recoupé » "
        "n'ont pas encore été confrontées à la source officielle : le calcul les utilise, mais "
        "l'affichage le signale."
    )
    lignes_prov = []
    for cle, valeur in provenance.items():
        lignes_prov.append([
            cle,
            str(valeur.get("fichier", "—")),
            str(valeur.get("annee", "—")),
            _fr_date(valeur.get("date_verif")),
            "non recoupé" if valeur.get("verifie") is False else "vérifié",
        ])
    lignes_prov.append([
        "declarations", "data/declarations.yaml", str(decl.get("annee", "—")),
        _fr_date(decl.get("date_verif")), "partiellement recoupé",
    ])
    d.tableau(
        ["Bloc", "Fichier", "Année", "Contrôlé le", "État"],
        [30, 56, 20, 32, 36],
        lignes_prov,
    )
    d.titre2("Valeurs restant à confirmer")
    d.puces([
        f"Taux de TFCC ({_pct(decl['tfcc']['BIC_SERVICE']['taux'])} en services, "
        f"{_pct(decl['tfcc']['BIC_VENTE']['taux'])} en vente) — donnés comme approximatifs "
        "par la source.",
        f"Seuil d'exonération de CFP la première année "
        f"({_eur0(C.seuil_cfp_premiere_annee())}).",
        "Numéros de case du formulaire 3310-CA3 — non confirmés, donc jamais affichés.",
        "Barème de l'impôt, quotient familial et décote — non encore recoupés avec la source "
        "officielle.",
        "Montant de la CFE — non calculable : le barème est voté commune par commune.",
    ])

    d.encadre(
        "En cas de doute",
        "Tous les montants produits sont des estimations préparatoires. Faites-les vérifier "
        "par un expert-comptable avant tout dépôt : la responsabilité de la déclaration reste "
        "la vôtre.",
        encre=ALERTE_INK, fond=ALERTE_BG,
    )

    return d.octets()


def main() -> None:
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parents[2] / "NOTE-CALCULS-FISCAUX.pdf"
    )
    destination.write_bytes(construire())
    print(f"Note générée : {destination}")


if __name__ == "__main__":
    main()
