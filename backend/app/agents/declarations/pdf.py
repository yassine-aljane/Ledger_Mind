"""Document de déclaration — destiné à la signature d'un expert-comptable.

Ce n'est ni une liste de champs ni un lien vers un téléservice : c'est une PIÈCE, qui identifie
l'entreprise, énonce la période, reprend les cases officielles du formulaire, détaille les
prélèvements et se termine par un **bloc de signature** — attestation du déclarant, puis visa
de l'expert-comptable avec date, cachet et signature.

Ce que le document dit de lui-même, en toutes lettres :

  * il n'a **pas été transmis** à l'administration ;
  * chaque montant porte sa **provenance**, pour que le visa engage sur des chiffres vérifiables
    et non sur une confiance aveugle ;
  * une référence de case **non recoupée** est marquée comme telle plutôt que présentée comme
    fiable.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.agents.facture.pdf import (
    BORDER,
    BUTTER_BG,
    BUTTER_INK,
    CREME,
    INK,
    MUTED,
    NAVY,
    NAVY_BG,
    _eur,
    _LATIN1_REPL,
    _setup_font,
)

from .schemas import Brouillon, JeuDeclarations

ALERTE_INK = (150, 42, 42)
ALERTE_BG = (252, 238, 238)

_MENTION_PIED = (
    "Document préparé automatiquement à partir des pièces de l'entreprise. NON TRANSMIS à "
    "l'administration. Il ne vaut ni déclaration déposée ni conseil fiscal."
)


def _fr_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    p = str(iso)[:10].split("-")
    return f"{p[2]}/{p[1]}/{p[0]}" if len(p) == 3 else str(iso)


def _pct(taux: Optional[float]) -> str:
    if taux is None:
        return "—"
    valeur = taux * 100
    decimales = 0 if abs(valeur - round(valeur)) < 0.005 else (1 if valeur >= 1 else 3)
    return f"{valeur:.{decimales}f} %".replace(".", ",")


def _classe_document():
    from fpdf import FPDF

    class Document(FPDF):
        police = "Helvetica"
        rendre_texte = staticmethod(lambda s: s)

        def footer(self) -> None:  # noqa: D102 - contrat fpdf2
            self.set_y(-15)
            self.set_font(self.police, "", 7)
            self.set_text_color(*MUTED)
            self.multi_cell(178, 3.4, self.rendre_texte(_MENTION_PIED), align="C")
            self.set_y(-6)
            self.cell(0, 4, self.rendre_texte(f"page {self.page_no()}"), align="R")

    return Document


def brouillon_to_pdf(
    brouillon: Brouillon,
    jeu: JeuDeclarations,
    emetteur: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Rend UNE déclaration en document signable."""
    emetteur = emetteur or {}
    pdf = _classe_document()(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=24)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
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

    def eur(n: Optional[float]) -> str:
        return _eur(n, unicode_ok) if n is not None else "—"

    def titre_section(libelle: str) -> None:
        if pdf.get_y() > 245:
            pdf.add_page()
        pdf.ln(4)
        pdf.set_text_color(*NAVY)
        pdf.set_font(font, "B", 11)
        pdf.cell(0, 6, texte(libelle), ln=1)
        pdf.set_draw_color(*BORDER)
        pdf.line(16, pdf.get_y(), 194, pdf.get_y())
        pdf.ln(2)
        pdf.set_text_color(*INK)

    def cle_valeur(cle: str, valeur: str, gras: bool = False) -> None:
        pdf.set_font(font, "", 9)
        pdf.set_text_color(*MUTED)
        pdf.cell(70, 5.5, texte(cle))
        pdf.set_font(font, "B" if gras else "", 10 if gras else 9)
        pdf.set_text_color(*INK)
        pdf.cell(0, 5.5, texte(valeur), ln=1)

    def paragraphe(contenu: str, taille: float = 8, couleur=MUTED) -> None:
        pdf.set_font(font, "", taille)
        pdf.set_text_color(*couleur)
        pdf.multi_cell(178, 4.2, texte(contenu))
        pdf.set_text_color(*INK)

    # --- En-tête -----------------------------------------------------------
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_xy(16, 8)
    pdf.set_text_color(*CREME)
    pdf.set_font(font, "B", 15)
    pdf.cell(0, 7, texte(brouillon.titre.upper()), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 9.5)
    reference = brouillon.formulaire or brouillon.teleservice or ""
    pdf.cell(0, 5, texte(
        (f"Formulaire {reference}" if brouillon.formulaire else f"Téléservice {reference}")
        + (f"  ·  CERFA n°{brouillon.cerfa}" if brouillon.cerfa else "")
    ), ln=1)
    pdf.set_y(36)
    pdf.set_text_color(*INK)

    # --- Bandeau : document non transmis ------------------------------------
    _encadre(pdf, font, texte, ALERTE_INK, ALERTE_BG,
             "DOCUMENT NON TRANSMIS À L'ADMINISTRATION",
             "Cette pièce est établie pour vérification et visa. La déclaration effective "
             "reste à déposer par le déclarant sur le portail officiel.")

    # --- Identification -----------------------------------------------------
    titre_section("Identification du déclarant")
    cle_valeur("Dénomination", emetteur.get("denomination") or "—", gras=True)
    cle_valeur("SIREN", emetteur.get("siren") or "—")
    if emetteur.get("adresse"):
        cle_valeur("Adresse", str(emetteur["adresse"]))
    if emetteur.get("numero_tva_intracom"):
        cle_valeur("N° de TVA intracommunautaire", str(emetteur["numero_tva_intracom"]))

    # --- Période ------------------------------------------------------------
    titre_section("Période déclarée")
    cle_valeur("Du", _fr_date(brouillon.periode_debut), gras=True)
    cle_valeur("Au", _fr_date(brouillon.periode_fin), gras=True)
    cle_valeur("Périodicité", brouillon.frequence)
    if brouillon.echeance:
        cle_valeur("Échéance", str(brouillon.echeance))

    if not brouillon.applicable:
        titre_section("Non applicable sur cette période")
        paragraphe(brouillon.motif_non_applicable or "")
        _bloc_signature(pdf, font, texte, titre_section, sans_montant=True)
        return bytes(pdf.output())

    # --- Cases du formulaire ------------------------------------------------
    titre_section("Montants à reporter")
    _tableau_champs(pdf, font, texte, eur, brouillon)

    # --- Prélèvements -------------------------------------------------------
    if brouillon.type == "ca_urssaf" and jeu.prelevements:
        titre_section("Détail des prélèvements")
        _tableau_prelevements(pdf, font, texte, eur, jeu.prelevements)
        pdf.ln(1)
        cle_valeur("TOTAL À RÉGLER", eur(brouillon.montant_a_payer), gras=True)
    elif brouillon.montant_a_payer is not None:
        titre_section("Montant")
        cle_valeur("Total à régler", eur(brouillon.montant_a_payer), gras=True)

    # --- Détail de la TVA ---------------------------------------------------
    if brouillon.type == "tva_ca3" and jeu.tva_collectee:
        titre_section("Détail de la TVA collectée")
        if jeu.tva_collectee.get("lignes"):
            _tableau(pdf, font, texte,
                     largeurs=(34, 24, 58, 30, 32),
                     entetes=("Facture", "Date", "Client", "Base HT", "TVA"),
                     alignements=("L", "L", "L", "R", "R"),
                     lignes=[(l["numero"] or "—", _fr_date(l["date"]),
                              (l["client"] or "—")[:32], eur(l["base_ht"]), eur(l["tva"]))
                             for l in jeu.tva_collectee["lignes"]])
        else:
            paragraphe("Aucune facture émise avec TVA sur la période.")

        titre_section("Détail de la TVA déductible")
        paragraphe(jeu.tva_deductible.get("reserve", ""))
        pdf.ln(1)
        if jeu.tva_deductible.get("lignes"):
            _tableau(pdf, font, texte,
                     largeurs=(52, 24, 34, 30, 38),
                     entetes=("Fournisseur", "Date", "N° facture", "Base HT", "TVA"),
                     alignements=("L", "L", "L", "R", "R"),
                     lignes=[((l["fournisseur"] or "—")[:30], _fr_date(l["date"]),
                              (l["numero"] or "—")[:18], eur(l["base_ht"]), eur(l["tva"]))
                             for l in jeu.tva_deductible["lignes"]])
        else:
            paragraphe("Aucune facture d'achat capturée avec TVA lisible sur la période.")

    # --- Recoupement avec un rapport déjà établi ----------------------------
    if jeu.recoupement_rapport and not jeu.recoupement_rapport.get("concordant"):
        titre_section("Écart avec un rapport fiscal antérieur")
        r = jeu.recoupement_rapport
        cle_valeur("Chiffre d'affaires du rapport", eur(r.get("ca_du_rapport")))
        cle_valeur("Chiffre d'affaires déclaré ici", eur(r.get("ca_declare")))
        cle_valeur("Écart", eur(r.get("ecart")), gras=True)
        pdf.ln(1)
        paragraphe(
            "Une pièce a été ajoutée, corrigée ou supprimée entre les deux établissements. "
            "Identifiez laquelle avant de viser ce document."
        )

    # --- Avantages en nature : dans les cases, hors de tout relevé ----------
    if brouillon.type in ("ca_urssaf", "revenus_2042") and jeu.cadeaux_recus:
        titre_section("Avantages en nature inclus dans les montants déclarés")
        paragraphe(
            "Fiscalement, ce ne sont PAS des cadeaux : un partenariat rémunéré en produits "
            "est un revenu en nature, déclarable à sa valeur marchande. Ces montants sont "
            "compris dans les cases ci-dessus, alors qu'ils n'apparaissent sur AUCUN relevé "
            "bancaire — leur justification tient aux pièces jointes, pas à un virement."
        )
        pdf.ln(1)
        _tableau(
            pdf, font, texte,
            largeurs=(24, 54, 40, 28, 32),
            entetes=("Date", "Objet reçu", "Marque", "Contrepartie", "Valeur"),
            alignements=("L", "L", "L", "L", "R"),
            lignes=[
                (_fr_date(c.get("date")), (c.get("description") or "—")[:30],
                 (c.get("marque") or "—")[:22], (c.get("contrepartie") or "—")[:16],
                 eur(c.get("valeur_eur")))
                for c in jeu.cadeaux_recus
            ],
        )
        pdf.ln(1)
        cle_valeur("Total des avantages en nature", eur(jeu.total_cadeaux_eur), gras=True)

    if brouillon.type == "ca_urssaf" and jeu.cadeaux_a_valoriser:
        titre_section("Cadeaux reçus sans valeur retenue")
        paragraphe(
            f"{len(jeu.cadeaux_a_valoriser)} avantage(s) en nature ne sont PAS compris dans "
            "les montants ci-dessus, faute de valeur marchande retenue. Le chiffre d'affaires "
            "déclaré s'en trouve minoré : valorisez-les avant de transmettre."
        )

    # --- Contrats en cours : contexte, jamais une case ----------------------
    if brouillon.type == "ca_urssaf" and jeu.contrats_actifs:
        titre_section("Contrats en cours sur la période")
        paragraphe(
            "N'entrent dans AUCUNE case : un contrat engage, il n'encaisse pas. Ils figurent "
            "ici pour vérifier qu'aucune prestation exécutée n'a été oubliée à la facturation."
        )
        pdf.ln(1)
        _tableau(pdf, font, texte,
                 largeurs=(28, 62, 44, 44),
                 entetes=("Type", "Intitulé", "Contrepartie", "Montant"),
                 alignements=("L", "L", "L", "R"),
                 lignes=[((c.get("type") or "—")[:16], (c.get("titre") or "—")[:36],
                          (c.get("contrepartie") or "—")[:26], eur(c.get("montant_eur")))
                         for c in jeu.contrats_actifs])

    # --- Provenance des montants -------------------------------------------
    titre_section("Provenance des montants")
    paragraphe(
        "L'assiette retenue est le chiffre d'affaires ENCAISSÉ : seuls les virements reçus, "
        "rapprochés d'une facture émise et datés de la période, sont comptés. Une facture non "
        "encaissée comptera lors de son règlement."
    )
    for champ in brouillon.champs:
        if champ.provenance:
            paragraphe(f"•  {champ.libelle} — {champ.provenance}", taille=7.5)

    # --- Points de vigilance ------------------------------------------------
    if brouillon.points_de_vigilance:
        titre_section("Points de vigilance")
        for point in brouillon.points_de_vigilance:
            _encadre(pdf, font, texte, BUTTER_INK, BUTTER_BG, "", point)

    _bloc_signature(pdf, font, texte, titre_section)
    return bytes(pdf.output())


def _tableau(pdf, font, texte, *, largeurs, entetes, alignements, lignes) -> None:
    """Tableau générique, avec en-tête répété après un saut de page."""
    def en_tete() -> None:
        pdf.set_fill_color(*NAVY_BG)
        pdf.set_text_color(*NAVY)
        pdf.set_font(font, "B", 8)
        for largeur, entete, align in zip(largeurs, entetes, alignements):
            pdf.cell(largeur, 6.5, texte(entete), fill=True, align=align)
        pdf.ln(6.5)
        pdf.set_text_color(*INK)
        pdf.set_font(font, "", 8)

    en_tete()
    for ligne in lignes:
        if pdf.get_y() > 252:
            pdf.add_page()
            en_tete()
        for largeur, valeur, align in zip(largeurs, ligne, alignements):
            pdf.cell(largeur, 5.6, texte(str(valeur)), align=align)
        pdf.ln(5.6)


def _tableau_champs(pdf, font, texte, eur, brouillon: Brouillon) -> None:
    """Les cases officielles. Une référence non recoupée est marquée, jamais tue."""
    largeurs = (18, 96, 34, 30)
    entetes = ("Case", "Libellé officiel", "Montant", "Fiabilité")

    pdf.set_fill_color(*NAVY_BG)
    pdf.set_text_color(*NAVY)
    pdf.set_font(font, "B", 8)
    for largeur, entete in zip(largeurs, entetes):
        pdf.cell(largeur, 6.5, texte(entete), fill=True,
                 align="R" if entete == "Montant" else "L")
    pdf.ln(6.5)

    pdf.set_text_color(*INK)
    pdf.set_font(font, "", 8)
    for champ in brouillon.champs:
        if pdf.get_y() > 250:
            pdf.add_page()
        if isinstance(champ.valeur, bool):
            valeur = "Oui" if champ.valeur else "Non"
        elif isinstance(champ.valeur, (int, float)):
            valeur = eur(champ.valeur) if champ.unite == "EUR" else str(champ.valeur)
        else:
            valeur = str(champ.valeur) if champ.valeur else "à compléter"

        pdf.cell(largeurs[0], 5.6, texte(champ.case or "—"))
        pdf.cell(largeurs[1], 5.6, texte(champ.libelle[:58]))
        pdf.cell(largeurs[2], 5.6, texte(valeur), align="R")
        pdf.set_text_color(*(BUTTER_INK if champ.fiabilite == "a_verifier" else MUTED))
        pdf.cell(largeurs[3], 5.6,
                 texte("À VÉRIFIER" if champ.fiabilite == "a_verifier" else "confirmée"))
        pdf.set_text_color(*INK)
        pdf.ln(5.6)
        pdf.set_draw_color(*BORDER)
        pdf.line(16, pdf.get_y(), 194, pdf.get_y())


def _tableau_prelevements(pdf, font, texte, eur, prelevements: Dict[str, Any]) -> None:
    largeurs = (74, 34, 34, 36)
    entetes = ("Prélèvement", "Assiette", "Taux", "Montant")

    pdf.set_fill_color(*NAVY_BG)
    pdf.set_text_color(*NAVY)
    pdf.set_font(font, "B", 8)
    for largeur, entete in zip(largeurs, entetes):
        pdf.cell(largeur, 6.5, texte(entete), fill=True,
                 align="L" if entete == "Prélèvement" else "R")
    pdf.ln(6.5)
    pdf.set_text_color(*INK)
    pdf.set_font(font, "", 8)

    def ligne(libelle: str, assiette: float, taux: Optional[float], montant: float) -> None:
        if pdf.get_y() > 250:
            pdf.add_page()
        pdf.cell(largeurs[0], 5.6, texte(libelle))
        pdf.cell(largeurs[1], 5.6, texte(eur(assiette)), align="R")
        pdf.cell(largeurs[2], 5.6, texte(_pct(taux)), align="R")
        pdf.cell(largeurs[3], 5.6, texte(eur(montant)), align="R")
        pdf.ln(5.6)

    for poste in prelevements.get("postes") or []:
        ligne(f"Cotisations sociales — {poste['categorie']}", poste["ca"],
              poste.get("taux_cotisations"), poste["cotisations_sociales"])
        libelle_cfp = "Formation professionnelle (CFP)"
        if poste.get("cfp_exoneree"):
            libelle_cfp += " — exonérée"
        ligne(libelle_cfp, poste["ca"], poste.get("taux_cfp"), poste["cfp"])
        if poste.get("tfcc_applicable"):
            ligne("Chambre consulaire (TFCC)", poste["ca"], poste.get("taux_tfcc"),
                  poste["tfcc"])
        if poste.get("versement_liberatoire") is not None:
            ligne("Versement libératoire de l'impôt", poste["ca"],
                  poste.get("taux_versement_liberatoire"), poste["versement_liberatoire"])


def _encadre(pdf, font, texte, encre, fond, titre: str, message: str) -> None:
    if pdf.get_y() > 240:
        pdf.add_page()
    pdf.set_fill_color(*fond)
    pdf.set_draw_color(*fond)
    pdf.set_x(16)
    pdf.set_text_color(*encre)
    if titre:
        pdf.set_font(font, "B", 9)
        pdf.multi_cell(178, 5, texte(titre), fill=True)
        pdf.set_x(16)
    pdf.set_font(font, "", 7.5)
    pdf.multi_cell(178, 4, texte(message), fill=True)
    pdf.set_text_color(*INK)
    pdf.ln(2)


def _bloc_signature(pdf, font, texte, titre_section, sans_montant: bool = False) -> None:
    """Attestation du déclarant puis visa de l'expert-comptable.

    Deux signatures distinctes, et c'est le fond du document : le déclarant atteste de
    l'exactitude de ses pièces, l'expert-comptable vise ce qu'il a vérifié. Confondre les
    deux ferait porter à l'un la responsabilité de l'autre.
    """
    if pdf.get_y() > 195:
        pdf.add_page()

    titre_section("Attestation et visa")
    pdf.set_font(font, "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(178, 4, texte(
        "Le déclarant atteste de l'exactitude et de l'exhaustivité des pièces transmises. "
        "L'expert-comptable appose son visa sur les montants qu'il a vérifiés. Ce visa ne vaut "
        "pas dépôt : la transmission à l'administration reste à la charge du déclarant."
    ))
    pdf.set_text_color(*INK)
    pdf.ln(3)

    y = pdf.get_y()
    largeur = 86
    for index, (titre, lignes) in enumerate([
        ("LE DÉCLARANT", ["Nom et qualité", "Fait à", "Le", "Signature"]),
        ("L'EXPERT-COMPTABLE", ["Nom et n° d'inscription à l'Ordre",
                                "Cabinet", "Le", "Signature et cachet"]),
    ]):
        x = 16 + index * (largeur + 6)
        pdf.set_xy(x, y)
        pdf.set_draw_color(*BORDER)
        pdf.rect(x, y, largeur, 52)
        pdf.set_xy(x + 4, y + 4)
        pdf.set_font(font, "B", 8)
        pdf.set_text_color(*NAVY)
        pdf.cell(largeur - 8, 5, texte(titre), ln=2)
        pdf.set_font(font, "", 7.5)
        pdf.set_text_color(*MUTED)
        for libelle in lignes:
            pdf.set_x(x + 4)
            pdf.cell(largeur - 8, 4.5, texte(libelle), ln=2)
            # Ligne à remplir à la main.
            trait_y = pdf.get_y() + 3
            pdf.set_draw_color(210, 214, 222)
            pdf.line(x + 4, trait_y, x + largeur - 4, trait_y)
            pdf.set_y(trait_y + 2)
    pdf.set_y(y + 56)
    pdf.set_text_color(*INK)


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

    sortie = io.BytesIO()
    ecrivain.write(sortie)
    return sortie.getvalue()
