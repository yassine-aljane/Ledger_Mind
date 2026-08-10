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

from . import templates
from .schemas import Brouillon, JeuDeclarations


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
