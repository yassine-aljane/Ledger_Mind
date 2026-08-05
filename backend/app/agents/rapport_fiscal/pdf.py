"""Export PDF du rapport fiscal — même palette et même socle typographique que la facture.

Ce module n'AFFICHE que ce que l'orchestrateur a déjà produit : aucun montant n'est recalculé,
aucun taux n'est cité qui ne vienne de la `provenance` du rapport. Un chiffre absent du rapport
reste absent du PDF ; il n'y est jamais remplacé par un zéro, qui se lirait comme un résultat.

Le PDF est un document de travail, pas une déclaration : le pied de page le dit sur chaque
page, et la page 2 détaille le rapprochement pour que chaque euro soit remontable à un virement.
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
    _setup_font,
)

from .schemas import RapportFiscal

# Rouge sobre pour les alertes critiques — le seul ajout à la palette produit.
ALERTE_INK = (150, 42, 42)
ALERTE_BG = (252, 238, 238)

_COULEUR_ALERTE = {
    "critique": (ALERTE_INK, ALERTE_BG),
    "vigilance": (BUTTER_INK, BUTTER_BG),
    "info": (NAVY, NAVY_BG),
}

_TITRE = "Rapport fiscal — chiffre d'affaires encaissé"


def _pct(taux: Optional[float]) -> str:
    """Taux en pourcentage. Un taux de 0,2 % ne doit pas s'afficher « 0 % »."""
    if taux is None:
        return "—"
    valeur = taux * 100
    decimales = 0 if abs(valeur - round(valeur)) < 0.005 else (1 if valeur >= 1 else 2)
    return f"{valeur:.{decimales}f} %".replace(".", ",")


def _fr_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    parties = str(iso)[:10].split("-")
    return f"{parties[2]}/{parties[1]}/{parties[0]}" if len(parties) == 3 else str(iso)


_MENTION_PIED = (
    "Document d'aide à la préparation, généré automatiquement à partir de vos factures et de vos "
    "relevés. Il ne vaut ni déclaration ni conseil fiscal : faites-le vérifier avant tout dépôt."
)


def _classe_document():
    """FPDF avec un vrai pied de page — imprimé sur CHAQUE page, pas seulement la dernière.

    Défini ici et non au niveau du module : `fpdf` n'est importé qu'à l'appel, pour ne pas
    peser au démarrage de l'API.
    """
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


def rapport_to_pdf(rapport: RapportFiscal) -> bytes:
    """Rend le rapport en PDF. Les champs nuls s'affichent « non calculé », jamais « 0 »."""
    pdf = _classe_document()(format="A4", unit="mm")
    # La marge basse doit dégager le pied de page, sinon le contenu passe dessous.
    pdf.set_auto_page_break(auto=True, margin=24)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    font, unicode_ok = _setup_font(pdf)

    def texte(s: str) -> str:
        from app.agents.facture.pdf import _LATIN1_REPL

        s = s or ""
        if unicode_ok:
            return s
        for k, v in _LATIN1_REPL.items():
            s = s.replace(k, v)
        return s.encode("latin-1", "replace").decode("latin-1")

    # Le pied de page se dessine à chaque saut de page : il lui faut la police retenue et le
    # transcodeur, qui n'existent qu'ici.
    pdf.police = font
    pdf.rendre_texte = texte

    def eur(n: Optional[float]) -> str:
        # None ≠ 0 : un calcul non effectué ne doit jamais se lire comme un résultat nul.
        return _eur(n, unicode_ok) if n is not None else "non calculé"

    def titre_section(libelle: str) -> None:
        if pdf.get_y() > 250:
            pdf.add_page()
        pdf.ln(4)
        pdf.set_text_color(*NAVY)
        pdf.set_font(font, "B", 12)
        pdf.cell(0, 7, texte(libelle), ln=1)
        pdf.set_draw_color(*BORDER)
        pdf.line(16, pdf.get_y(), 194, pdf.get_y())
        pdf.ln(2)
        pdf.set_text_color(*INK)

    def ligne_cle_valeur(
        cle: str, valeur: str, gras: bool = False, aide: Optional[str] = None
    ) -> None:
        pdf.set_font(font, "", 9.5)
        pdf.set_text_color(*MUTED)
        pdf.cell(96, 6, texte(f"{cle} ({aide})" if aide else cle))
        pdf.set_font(font, "B" if gras else "", 10 if gras else 9.5)
        pdf.set_text_color(*INK)
        pdf.cell(0, 6, texte(valeur), ln=1, align="R")

    def paragraphe(contenu: str, taille: float = 8.5, couleur=MUTED) -> None:
        pdf.set_font(font, "", taille)
        pdf.set_text_color(*couleur)
        pdf.multi_cell(178, 4.4, texte(contenu))
        pdf.set_text_color(*INK)

    # --- En-tête -------------------------------------------------------------
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_xy(16, 9)
    pdf.set_text_color(*CREME)
    pdf.set_font(font, "B", 16)
    pdf.cell(0, 8, texte(_TITRE), ln=1)
    pdf.set_x(16)
    pdf.set_font(font, "", 10)
    pdf.cell(0, 6, texte(
        f"Période du {_fr_date(rapport.date_debut)} au {_fr_date(rapport.date_fin)}"
        f"   ·   généré le {_fr_date(rapport.genere_le)}"
    ), ln=1)
    pdf.set_y(38)
    pdf.set_text_color(*INK)

    # --- Assiette ------------------------------------------------------------
    titre_section("Assiette retenue")
    ligne_cle_valeur("Chiffre d'affaires encaissé", eur(rapport.ca_retenu), gras=True)
    # Décomposition numéraire / nature dès qu'un avantage entre dans l'assiette : sans
    # elle, le total ne se retrouve sur aucun relevé bancaire et paraît faux.
    if rapport.recettes_en_nature > 0:
        ligne_cle_valeur("dont encaissé en numéraire", eur(rapport.ca_encaisse_numeraire))
        ligne_cle_valeur(
            "dont reçu en nature (cadeaux et dotations)",
            eur(rapport.recettes_en_nature),
            aide=f"{rapport.sources.cadeaux_declares} pièce(s) déclarée(s)",
        )
    rap = rapport.rapprochement
    if rap:
        ligne_cle_valeur("dont rattaché avec certitude à une facture", eur(rap.ca_encaisse_certain))
        incertain = round(rap.ca_encaisse - rap.ca_encaisse_certain, 2)
        if incertain > 0:
            ligne_cle_valeur("dont rattaché par montant et date (à confirmer)", eur(incertain))

    # Indicateur d'écart, jamais assiette : facturer n'est pas encaisser.
    # Comparé au seul encaissé EN NUMÉRAIRE : un avantage en nature n'a jamais été facturé,
    # l'inclure ici creuserait un écart qui ne traduirait aucun impayé.
    ligne_cle_valeur("Chiffre d'affaires facturé sur la période", eur(rapport.ca_facture_periode))
    ecart = round(rapport.ca_facture_periode - rapport.ca_encaisse_numeraire, 2)
    if abs(ecart) > 0.01:
        ligne_cle_valeur(
            "Écart facturé − encaissé",
            eur(ecart),
            aide="facturé non encore rentré" if ecart > 0 else "encaissements de périodes antérieures",
        )
    pdf.ln(1)
    paragraphe(rapport.base_de_calcul)

    if rapport.rapprochement and rapport.rapprochement.ca_par_categorie:
        pdf.ln(1)
        for nature, montant in sorted(rapport.rapprochement.ca_par_categorie.items()):
            ligne_cle_valeur(f"Ventilation — {nature}", eur(montant))

    # --- Résultat du calcul --------------------------------------------------
    sim: Dict[str, Any] = rapport.simulation or {}
    titre_section("Impôt et cotisations")
    if rapport.categories_fiscales:
        ligne_cle_valeur("Catégorie fiscale appliquée",
                         " + ".join(rapport.categories_fiscales), gras=True)
    # Le calcul est TOUJOURS effectué : à CA nul, les montants valent zéro, ce qui est un
    # résultat. L'ancien « aucun calcul n'a été effectué » se lisait comme une panne.
    ligne_cle_valeur("Base imposable après abattement", eur(sim.get("base_imposable")))
    ligne_cle_valeur("Cotisations sociales (assises sur le CA plein)",
                     eur(sim.get("cotisations_sociales")))
    ligne_cle_valeur("Contribution à la formation professionnelle", eur(sim.get("cfp")))
    ligne_cle_valeur("Impôt sur le revenu imputable à l'activité", eur(sim.get("ir_bareme")))
    pdf.ln(1)
    ligne_cle_valeur("Total des prélèvements", eur(sim.get("total_prelevements")), gras=True)
    ligne_cle_valeur("Revenu net estimé", eur(sim.get("revenu_net_estime")))
    taux = sim.get("taux_effectif")
    ligne_cle_valeur(
        "Taux effectif de prélèvement",
        f"{taux * 100:.1f} %".replace(".", ",") if taux is not None
        # Sans chiffre d'affaires, le rapport prélèvements / CA n'a pas de sens : « non
        # applicable » plutôt qu'un 0 % qui se lirait « rien à payer ».
        else "non applicable (CA nul)" if not sim.get("ca_total") else "non calculé",
    )

    if sim.get("lignes"):
        pdf.ln(2)
        _tableau_lignes(pdf, font, texte, eur, sim["lignes"])

    # --- Barème contre versement libératoire ---
    vl = sim.get("versement_liberatoire") or {}
    titre_section("Barème ou versement libératoire")
    ligne_cle_valeur("Impôt au barème progressif", eur(sim.get("ir_bareme")))
    ligne_cle_valeur("Impôt au versement libératoire", eur(vl.get("montant")))
    ligne_cle_valeur("Éligibilité au versement libératoire", {
        True: "éligible", False: "non éligible", None: "indéterminée",
    }.get(vl.get("eligible"), "indéterminée"))
    option = sim.get("option_retenue")
    if option:
        ligne_cle_valeur("Option retenue dans ce rapport",
                         "versement libératoire" if option != "bareme" else "barème progressif",
                         gras=True)
    pdf.ln(1)
    if sim.get("recommandation"):
        paragraphe(str(sim["recommandation"]))
    elif vl.get("motif_ineligibilite"):
        paragraphe(
            f"Comparaison impossible : {vl['motif_ineligibilite']} Renseignez ces informations "
            "pour savoir laquelle des deux options vous coûte le moins."
        )
    else:
        paragraphe(
            "Comparaison non concluante : l'un des deux montants n'a pas pu être calculé."
        )

    # --- Contrôle du plafond du régime micro ---------------------------------
    etats_plafond = (rapport.plafonds or {}).get("plafonds") or []
    if etats_plafond:
        titre_section("Contrôle du plafond du régime micro")
        for etat in etats_plafond:
            statut = "CONFORME" if etat["conforme"] else "DÉPASSEMENT"
            ligne_cle_valeur(
                f"{etat['categorie']} — {eur(etat['ca'])} pour un plafond de "
                f"{eur(etat['plafond'])}",
                statut,
                gras=not etat["conforme"],
                aide="proratisé" if etat.get("plafond_proratise") else None,
            )
            if etat["conforme"]:
                ligne_cle_valeur("Marge restante avant le plafond", eur(etat["marge_restante"]))
        pdf.ln(1)
        paragraphe(str((rapport.plafonds or {}).get("note", "")))

    # --- Prorata de première année -------------------------------------------
    prorata = rapport.prorata or {}
    if prorata.get("applique"):
        titre_section("Prorata de première année")
        ligne_cle_valeur("Date de création de l'activité", _fr_date(prorata.get("date_creation")))
        ligne_cle_valeur("Jours d'activité sur la période", str(prorata.get("jours_activite")))
        ligne_cle_valeur("Méthode", str(prorata.get("methode")))
        for p in prorata.get("plafonds_proratises") or []:
            ligne_cle_valeur(f"Plafond proratisé — {p['categorie']}", eur(p["plafond"]))
        pdf.ln(1)
        paragraphe(str(prorata.get("note", "")))

    # --- TVA : drapeau seul --------------------------------------------------
    if rapport.tva and rapport.tva.get("lignes"):
        titre_section("Franchise en base de TVA")
        ligne_cle_valeur("Statut", str(rapport.tva.get("libelle_statut", "—")),
                         gras=rapport.tva.get("statut") != "franchise_conservee")
        for ligne in rapport.tva["lignes"]:
            etat = ("seuil majoré dépassé" if ligne["depasse_majore"]
                    else "seuil de base dépassé" if ligne["depasse_base"]
                    else f"sous le seuil (reste {_eur(ligne['reste_avant_base'], unicode_ok)})")
            ligne_cle_valeur(f"{ligne['libelle']} — {_eur(ligne['ca'], unicode_ok)}", etat)
        pdf.ln(1)
        paragraphe(rapport.tva.get("note", ""))

    # --- ACRE ----------------------------------------------------------------
    etat_acre = rapport.acre or {}
    if etat_acre:
        titre_section("Aide à la création d'entreprise (ACRE)")
        ligne_cle_valeur("ACRE", "Oui" if etat_acre.get("active") else "Non", gras=True)
        ligne_cle_valeur("Réduction des cotisations sociales",
                         f"{etat_acre.get('reduction_pourcent', 0)} %")
        if etat_acre.get("active"):
            ligne_cle_valeur("Début de l'exonération", _fr_date(etat_acre.get("date_debut")))
            restants = etat_acre.get("trimestres_restants")
            ligne_cle_valeur(
                "Trimestres civils restants",
                "indéterminé" if restants is None else str(restants),
            )
            ligne_cle_valeur("Fin estimée", _fr_date(etat_acre.get("date_fin_estimee")))
        pdf.ln(1)
        paragraphe(
            (etat_acre.get("note") or "")
            + (" " if etat_acre.get("note") else "")
            + str(etat_acre.get("hypothese", ""))
        )

    # --- Constantes appliquées : le calcul doit être vérifiable --------------
    if rapport.parametres:
        titre_section("Paramètres appliqués")
        _tableau(
            pdf, font, texte,
            largeurs=(30, 26, 26, 24, 26, 46),
            entetes=("Catégorie", "Abattement", "Cotisations", "CFP", "Vers. lib.", "Plafond CA"),
            alignements=("L", "R", "R", "R", "R", "R"),
            lignes=[
                (
                    p["categorie"] + (f" ({p['caisse_bnc']})" if p.get("caisse_bnc") else ""),
                    _pct(p.get("taux_abattement")),
                    _pct(p.get("taux_social")),
                    _pct(p.get("taux_cfp")),
                    _pct(p.get("taux_versement_liberatoire")),
                    eur(p.get("plafond_ca"))
                    + (" (proratisé)" if p.get("plafond_proratise") else ""),
                )
                for p in rapport.parametres
            ],
        )
        pdf.ln(1)
        paragraphe(
            "Ces taux sont ceux effectivement appliqués ci-dessus. Leur provenance et leur date "
            "de contrôle figurent en fin de rapport."
        )

    # --- Pièces du dossier : elles éclairent, elles n'entrent pas dans l'assiette -------
    src = rapport.sources
    if src.contrats or src.depenses:
        titre_section("Pièces prises en compte")
        ligne_cle_valeur("Factures émises analysées", str(src.factures_emises))
        ligne_cle_valeur("Virements analysés", str(src.virements_analyses))
        ligne_cle_valeur("Contrats en cours sur la période", str(src.contrats_en_cours))
        ligne_cle_valeur("Factures de dépense capturées", str(src.depenses_capturees))
        pdf.ln(1)

    if src.contrats:
        titre_section("Contrats en cours")
        paragraphe(
            "Un contrat engage, il n'encaisse pas : ces montants ne comptent pas dans le "
            "chiffre d'affaires. Ils comptent au fil de leurs encaissements."
        )
        pdf.ln(1)
        _tableau(
            pdf, font, texte,
            largeurs=(30, 56, 30, 30, 32),
            entetes=("Type", "Intitulé / contrepartie", "Début", "Fin", "Montant"),
            alignements=("L", "L", "L", "L", "R"),
            lignes=[
                (
                    (c.type or "—")[:18],
                    ((c.titre or c.contrepartie or "—"))[:36],
                    _fr_date(c.date_debut),
                    "indéterminée" if c.duree_indeterminee else _fr_date(c.date_fin),
                    eur(c.montant_eur),
                )
                for c in src.contrats
            ],
        )

    if src.depenses:
        titre_section("Dépenses capturées")
        paragraphe(
            "Informatives UNIQUEMENT. En micro-entreprise, l'abattement forfaitaire remplace "
            "la déduction des frais réels : ces montants ne réduisent ni la base imposable, ni "
            "l'assiette sociale. Ils servent à mesurer la marge réelle."
        )
        pdf.ln(1)
        _tableau(
            pdf, font, texte,
            largeurs=(52, 34, 26, 32, 34),
            entetes=("Fournisseur", "N° de facture", "Date", "Catégorie", "Montant"),
            alignements=("L", "L", "L", "L", "R"),
            lignes=[
                (
                    (d.fournisseur or "—")[:32],
                    (d.numero or "—")[:20],
                    _fr_date(d.date),
                    (d.categorie or "—")[:18],
                    eur(d.montant_eur),
                )
                for d in src.depenses
            ],
        )
        pdf.ln(1)
        ligne_cle_valeur("Total des dépenses (non déductible)", eur(src.total_depenses_eur),
                         gras=True)

    # --- Alertes -------------------------------------------------------------
    if rapport.alertes:
        titre_section("Points d'attention")
        for alerte in rapport.alertes:
            encre, fond = _COULEUR_ALERTE.get(alerte.niveau, (NAVY, NAVY_BG))
            _encadre(pdf, font, texte, encre, fond, alerte.titre, alerte.message)

    # --- Détail du rapprochement (auditabilité) ------------------------------
    if rap:
        _page_rapprochement(pdf, font, texte, eur, rap, titre_section, paragraphe)

    # --- Hypothèses et provenance -------------------------------------------
    titre_section("Hypothèses retenues")
    for h in rapport.hypotheses:
        paragraphe(f"•  {h}")
    if rapport.provenance:
        pdf.ln(2)
        titre_section("Provenance des taux et barèmes")
        paragraphe(_texte_provenance(rapport.provenance))

    return bytes(pdf.output())


def _encadre(pdf, font, texte, encre, fond, titre: str, message: str) -> None:
    """Bloc coloré titre + message, avec saut de page si la place manque."""
    if pdf.get_y() > 240:
        pdf.add_page()
    y0 = pdf.get_y()
    pdf.set_fill_color(*fond)
    pdf.set_draw_color(*fond)
    pdf.set_xy(16, y0 + 1)
    pdf.set_text_color(*encre)
    pdf.set_font(font, "B", 9.5)
    pdf.multi_cell(178, 5.2, texte(titre), fill=True)
    pdf.set_x(16)
    pdf.set_font(font, "", 8.5)
    pdf.multi_cell(178, 4.4, texte(message), fill=True)
    pdf.set_text_color(*INK)
    pdf.ln(2.5)


def _tableau(pdf, font, texte, *, largeurs, entetes, alignements, lignes) -> None:
    """Tableau générique, avec saut de page géré — fpdf2 ne le fait pas pour les `cell`."""
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
        if pdf.get_y() > 258:
            pdf.add_page()
            en_tete()
        for largeur, valeur, align in zip(largeurs, ligne, alignements):
            pdf.cell(largeur, 5.6, texte(str(valeur)), align=align)
        pdf.ln(5.6)


def _tableau_lignes(pdf, font, texte, eur, lignes: List[Dict[str, Any]]) -> None:
    """Détail par catégorie fiscale — indispensable en activité mixte."""
    largeurs = (46, 34, 26, 36, 36)
    entetes = ("Catégorie", "CA retenu", "Taux", "Abattement", "Base imposable")
    pdf.set_fill_color(*NAVY_BG)
    pdf.set_text_color(*NAVY)
    pdf.set_font(font, "B", 8.5)
    for largeur, entete in zip(largeurs, entetes):
        pdf.cell(largeur, 6.5, texte(entete), border=0, fill=True,
                 align="L" if entete == "Catégorie" else "R")
    pdf.ln(6.5)

    pdf.set_text_color(*INK)
    pdf.set_font(font, "", 8.5)
    plancher = False
    for ligne in lignes:
        taux = ligne.get("taux_abattement")
        plancher = plancher or bool(ligne.get("plancher_applique"))
        pdf.cell(largeurs[0], 6, texte(str(ligne.get("categorie", "—"))))
        pdf.cell(largeurs[1], 6, texte(eur(ligne.get("ca"))), align="R")
        pdf.cell(largeurs[2], 6,
                 texte(f"{taux * 100:.0f} %" if taux is not None else "—"), align="R")
        pdf.cell(largeurs[3], 6, texte(eur(ligne.get("abattement"))), align="R")
        pdf.cell(largeurs[4], 6, texte(eur(ligne.get("base_imposable"))), align="R")
        pdf.ln(6)
        pdf.set_draw_color(*BORDER)
        pdf.line(16, pdf.get_y(), 194, pdf.get_y())

    if plancher:
        pdf.ln(1.5)
        pdf.set_font(font, "", 7.5)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(178, 3.8, texte(
            "Le plancher d'abattement s'est appliqué : sur un CA faible, l'abattement forfaitaire "
            "ne peut pas descendre en dessous d'un minimum légal."
        ))
        pdf.set_text_color(*INK)


def _page_rapprochement(pdf, font, texte, eur, rap, titre_section, paragraphe) -> None:
    """Détail du rapprochement : c'est la pièce justificative de l'assiette déclarée."""
    pdf.add_page()
    titre_section("Détail des encaissements retenus")
    if not rap.encaissements:
        paragraphe("Aucun encaissement retenu sur la période.")
    else:
        largeurs = (22, 26, 26, 30, 42, 32)
        entetes = ("Date", "Reçu", "dont HT", "Facture", "Libellé", "Rattachement")
        pdf.set_fill_color(*NAVY_BG)
        pdf.set_text_color(*NAVY)
        pdf.set_font(font, "B", 8)
        for largeur, entete in zip(largeurs, entetes):
            pdf.cell(largeur, 6.5, texte(entete), fill=True,
                     align="R" if entete in ("Reçu", "dont HT") else "L")
        pdf.ln(6.5)
        pdf.set_text_color(*INK)
        pdf.set_font(font, "", 8)
        for e in rap.encaissements:
            if pdf.get_y() > 265:
                pdf.add_page()
            preuve = "n° de facture" if e.methode == "numero_facture" else (
                "montant + date — à confirmer" if e.methode == "montant_date" else "manuel")
            pdf.cell(largeurs[0], 5.6, texte(_fr_date(e.date_valeur)))
            pdf.cell(largeurs[1], 5.6, texte(eur(e.montant)), align="R")
            pdf.cell(largeurs[2], 5.6, texte(eur(e.montant_ht)), align="R")
            pdf.cell(largeurs[3], 5.6, texte(e.facture_numero or "—"))
            pdf.cell(largeurs[4], 5.6, texte((e.libelle or "—")[:32]))
            pdf.cell(largeurs[5], 5.6, texte(preuve))
            pdf.ln(5.6)
        pdf.ln(1)
        paragraphe(
            "Chaque ligne renvoie à un virement identifié : c'est la pièce justificative de "
            "l'assiette déclarée. La colonne « dont HT » est celle qui constitue le chiffre "
            "d'affaires : la TVA collectée n'est pas un revenu. Les rattachements « à confirmer » "
            "reposent sur une concordance de montant et de date, sans référence de facture dans "
            "le libellé."
        )

    if rap.virements_non_retenus:
        titre_section("Virements écartés du chiffre d'affaires")
        for v in rap.virements_non_retenus:
            _encadre(pdf, font, texte, BUTTER_INK, BUTTER_BG,
                     f"{eur(v.montant)} — {_fr_date(v.date_valeur)} — {v.libelle or 'sans libellé'}",
                     v.motif + (f" {v.action_suggeree}" if v.action_suggeree else ""))

    impayees = list(rap.factures_impayees) + list(rap.factures_partielles)
    if impayees:
        titre_section("Factures émises non soldées")
        paragraphe(
            "Ces montants ne comptent PAS dans le chiffre d'affaires de la période : ils "
            "compteront pour celle de leur encaissement."
        )
        pdf.ln(1)
        largeurs = (34, 52, 28, 30, 34)
        entetes = ("Facture", "Client", "Échéance", "Encaissé", "Reste dû")
        pdf.set_fill_color(*NAVY_BG)
        pdf.set_text_color(*NAVY)
        pdf.set_font(font, "B", 8)
        for largeur, entete in zip(largeurs, entetes):
            pdf.cell(largeur, 6.5, texte(entete), fill=True,
                     align="R" if entete in ("Encaissé", "Reste dû") else "L")
        pdf.ln(6.5)
        pdf.set_text_color(*INK)
        pdf.set_font(font, "", 8)
        for f in impayees:
            if pdf.get_y() > 265:
                pdf.add_page()
            retard = f" (retard {f.jours_de_retard} j)" if f.en_retard and f.jours_de_retard else ""
            pdf.cell(largeurs[0], 5.6, texte(f.numero or "—"))
            pdf.cell(largeurs[1], 5.6, texte((f.client or "—")[:34]))
            pdf.cell(largeurs[2], 5.6, texte(_fr_date(f.date_echeance) + retard))
            pdf.cell(largeurs[3], 5.6, texte(eur(f.encaisse)), align="R")
            pdf.cell(largeurs[4], 5.6, texte(eur(f.reste_du)), align="R")
            pdf.ln(5.6)


def _texte_provenance(provenance: Dict[str, Any]) -> str:
    """Rend la provenance lisible, quelle que soit la forme du dictionnaire du moteur."""
    morceaux: List[str] = []
    for cle, valeur in provenance.items():
        if not isinstance(valeur, dict):
            morceaux.append(f"{cle} : {valeur}")
            continue
        details = []
        if valeur.get("fichier"):
            details.append(str(valeur["fichier"]))
        if valeur.get("annee"):
            details.append(f"barème {valeur['annee']}")
        if valeur.get("source") or valeur.get("url"):
            details.append(str(valeur.get("source") or valeur.get("url")))
        if valeur.get("date_verif"):
            details.append(f"vérifié le {_fr_date(valeur['date_verif'])}")
        # `verifie: false` signale une valeur encore non recoupée avec la source officielle :
        # la taire reviendrait à présenter comme sûr un chiffre qui ne l'est pas.
        if valeur.get("verifie") is False:
            details.append("NON RECOUPÉ avec la source officielle")
        morceaux.append(f"•  {cle} — " + " · ".join(details))
    return "\n".join(morceaux) if morceaux else "Provenance non renseignée."
