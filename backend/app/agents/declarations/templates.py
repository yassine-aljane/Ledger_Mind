"""Les déclarations, telles que les formulaires officiels les présentent.

Chaque déclaration tient sur UNE page, celle du formulaire ou du téléservice officiel. Ce
n'est pas cosmétique : un expert-comptable vérifie une déclaration en la comparant à
l'imprimé qu'il connaît. Une mise en page inventée l'oblige à retrouver chaque rubrique ;
la mise en page officielle lui donne directement la case.

    ATTESTATION URSSAF     chiffres d'affaires, douze mois, quatre natures, et les
                           prélèvements calculés par le moteur d'impôt
    CERFA 2042 (10330*30)  déclaration des revenus + annexe 2042-C-PRO (5KO / 5KP / 5HQ)
    CERFA 1447-C-SD        cotisation foncière des entreprises — cadres A1 et A2
    DES (Prodouane)        téléservice des douanes — un imprimé n'existe pas, la page
                           reproduit les champs de l'interface
    CA3                    structure du formulaire, SANS numéros de case : ceux du
                           3310-CA3 n'ont pas été recoupés, les afficher tromperait

Deux règles gouvernent le module, et elles priment sur la ressemblance.

**Rien n'est inventé.** Un numéro que l'administration seule attribue — code de sécurité
URSSAF, n° de sécurité sociale, n° TI, n° fiscal — ne peut pas être reconstitué. Il est rendu
comme sur le formulaire vierge : une zone à remplir. Un document affichant un numéro plausible
mais faux serait pire qu'un document incomplet, parce qu'on ne le relirait pas.

**Aucun montant n'est calculé ici.** Les valeurs viennent du moteur d'impôt
(`app.agents.impots`) via le générateur ; ce module les met en page, rien de plus.

Ces pages ne sont pas les formulaires officiels et ne les remplacent pas : ce sont des
reproductions de travail, à recopier sur le téléservice ou sur l'imprimé de l'administration.
Chacune le dit sur elle-même.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from .schemas import Brouillon, JeuDeclarations

# Teintes des documents reproduits. Elles n'ont rien de décoratif : c'est à elles qu'on
# reconnaît l'imprimé d'un coup d'œil.
URSSAF_BLEU = (0, 84, 159)
URSSAF_BLEU_CLAIR = (222, 235, 247)
URSSAF_GRIS = (240, 240, 240)
CERFA_BLEU = (31, 95, 169)
CERFA_BLEU_PALE = (219, 231, 244)
CERFA_BLEU_TITRE = (26, 74, 130)
NOIR = (0, 0, 0)
GRIS_TEXTE = (90, 90, 95)
TRAIT = (150, 155, 165)

_MOIS_FR = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)

_MENTION_REPRODUCTION = (
    "Reproduction de travail du formulaire officiel, établie à partir des pièces de "
    "l'entreprise. Ce document N'A PAS été transmis à l'administration et ne vaut pas "
    "déclaration déposée. "
    # Divulgation IA (art. 50 du règlement (UE) 2024/1689). Elle est adossée à la mention
    # de reproduction plutôt qu'ajoutée en pied séparé : c'est le seul emplacement de la
    # page qui n'appartienne pas à l'imprimé officiel, et il est déjà rendu sur CHAQUE
    # gabarit. Un second pied viendrait se superposer aux cadres de signature.
    "[IA] Établi automatiquement par LedgerMind (intelligence artificielle) - "
    "à vérifier avant tout dépôt."
)


def date_du_jour() -> date:
    """Date d'établissement du document.

    Isolée dans une fonction pour rester substituable en test : un document daté du jour
    change tous les jours, un test ne peut pas comparer à une constante.
    """
    return date.today()


def _lettres(jour: date) -> str:
    """« 6 août 2026 » — la forme employée par les courriers de l'administration."""
    quantieme = "1er" if jour.day == 1 else str(jour.day)
    return f"{quantieme} {_MOIS_FR[jour.month - 1]} {jour.year}"


def _jjmmaaaa(jour: date) -> str:
    return jour.strftime("%d/%m/%Y")


def _date_lisible(iso: Optional[str]) -> Optional[str]:
    """Une date ISO venue du profil, rendue comme un courrier l'écrit."""
    if not iso:
        return None
    try:
        return _lettres(date.fromisoformat(str(iso)[:10]))
    except ValueError:
        return str(iso)


def _montant(valeur: Optional[float]) -> str:
    """Montant à la façon de l'attestation URSSAF. `None` devient « - » : période en cours."""
    if valeur is None:
        return "-"
    return f"{valeur:.2f}".replace(".", ",") + " €"


def _pct(taux: Optional[float]) -> str:
    """Taux en pourcentage. Le nombre de décimales suit l'ordre de grandeur : arrondir la
    TFCC (0,044 %) à deux décimales afficherait « 0,04 % », et à zéro « 0 % »."""
    if taux is None:
        return "—"
    valeur = taux * 100
    decimales = 0 if abs(valeur - round(valeur)) < 0.005 else (1 if valeur >= 1 else 3)
    return f"{valeur:.{decimales}f} %".replace(".", ",")


def _meme_nom(a: str, b: str) -> bool:
    """« Enzo Ciriani » et « CIRIANI ENZO » désignent la même personne."""
    return sorted(a.upper().replace("-", " ").split()) == sorted(
        b.upper().replace("-", " ").split()
    )


class _Rendu:
    """Petites primitives de mise en page, partagées par les trois formulaires.

    Elles portent le vocabulaire des imprimés — bandeau, cadre, case à cocher, ligne à
    remplir — plutôt que celui de fpdf, pour que le code se relise en regard du document.
    """

    def __init__(self, pdf, font: str, texte) -> None:
        self.pdf = pdf
        self.font = font
        self.t = texte

    # -- texte -------------------------------------------------------------
    def ecrire(self, x: float, y: float, largeur: float, hauteur: float, contenu: str, *,
               taille: float = 8, gras: bool = False, couleur=NOIR, align: str = "L") -> None:
        self.pdf.set_xy(x, y)
        self.pdf.set_font(self.font, "B" if gras else "", taille)
        self.pdf.set_text_color(*couleur)
        self.pdf.cell(largeur, hauteur, self.t(contenu), align=align)

    def paragraphe(self, x: float, y: float, largeur: float, contenu: str, *,
                   taille: float = 8, hauteur: float = 4.2, couleur=NOIR,
                   gras: bool = False) -> float:
        self.pdf.set_xy(x, y)
        self.pdf.set_font(self.font, "B" if gras else "", taille)
        self.pdf.set_text_color(*couleur)
        self.pdf.multi_cell(largeur, hauteur, self.t(contenu))
        return self.pdf.get_y()

    # -- traits et fonds ---------------------------------------------------
    def fond(self, x: float, y: float, largeur: float, hauteur: float, couleur) -> None:
        self.pdf.set_fill_color(*couleur)
        self.pdf.rect(x, y, largeur, hauteur, style="F")

    def cadre(self, x: float, y: float, largeur: float, hauteur: float,
              couleur=TRAIT, epaisseur: float = 0.2) -> None:
        self.pdf.set_draw_color(*couleur)
        self.pdf.set_line_width(epaisseur)
        self.pdf.rect(x, y, largeur, hauteur)
        self.pdf.set_line_width(0.2)

    def trait(self, x1: float, y: float, x2: float, couleur=TRAIT,
              epaisseur: float = 0.2) -> None:
        self.pdf.set_draw_color(*couleur)
        self.pdf.set_line_width(epaisseur)
        self.pdf.line(x1, y, x2, y)
        self.pdf.set_line_width(0.2)

    # -- éléments d'imprimé ------------------------------------------------
    def bandeau(self, x: float, y: float, largeur: float, titre: str, *,
                fond=URSSAF_BLEU, encre=(255, 255, 255), hauteur: float = 5.2,
                taille: float = 7.5) -> float:
        """Titre de rubrique en inverse vidéo, comme sur les imprimés."""
        self.fond(x, y, largeur, hauteur, fond)
        self.ecrire(x + 1.5, y, largeur - 3, hauteur, titre, taille=taille, gras=True,
                    couleur=encre)
        return y + hauteur

    def a_remplir(self, x: float, y: float, largeur: float, legende: str = "",
                  hauteur: float = 5) -> None:
        """Zone que seule l'administration ou le déclarant peut renseigner.

        C'est le refus d'inventer, rendu visible : plutôt qu'un numéro plausible, un
        emplacement vide et sa légende.
        """
        self.fond(x, y, largeur, hauteur, (250, 250, 250))
        self.cadre(x, y, largeur, hauteur, couleur=(205, 210, 220))
        if legende:
            self.ecrire(x + 1.5, y, largeur - 3, hauteur, legende, taille=6,
                        couleur=(160, 165, 175))

    def case_a_cocher(self, x: float, y: float, cochee: bool = False,
                      cote: float = 3.6) -> None:
        self.cadre(x, y, cote, cote, couleur=NOIR, epaisseur=0.3)
        if cochee:
            self.ecrire(x, y - 0.6, cote, cote + 1, "X", taille=7, gras=True, align="C")

    def valeur_ou_vide(self, x: float, y: float, largeur: float, valeur: Optional[str],
                       *, taille: float = 8, gras: bool = False) -> None:
        """Une valeur connue s'écrit ; une valeur inconnue laisse la ligne à remplir."""
        if valeur:
            self.ecrire(x, y, largeur, 5, str(valeur), taille=taille, gras=gras)
        else:
            self.trait(x, y + 4.4, x + largeur, couleur=(200, 205, 215))


def rendu_pour(pdf, font: str, texte) -> _Rendu:
    """Primitives de mise en page pour un document déjà ouvert par `pdf.py`."""
    return _Rendu(pdf, font, texte)


# ============================================================ 1. ATTESTATION URSSAF
def page_attestation_urssaf(pdf, rendu: _Rendu, jeu: JeuDeclarations,
                            brouillon: Brouillon, emetteur: Dict[str, Any]) -> None:
    """Attestation de déclarations de chiffres d'affaires — régime micro-social simplifié.

    L'original est délivré PAR l'URSSAF et porte un code de sécurité vérifiable en ligne.
    Celui-ci ne peut pas l'être : il est établi à partir des pièces de l'entreprise, et le
    dit. Le tableau, lui, suit exactement la présentation officielle — douze mois, quatre
    natures — parce que c'est cette présentation que l'URSSAF attend au téléservice.
    """
    jour = date_du_jour()
    annee = int(str(jeu.date_debut)[:4])

    # -- Bandeau d'en-tête -------------------------------------------------
    rendu.ecrire(8, 8, 60, 8, "Urssaf", taille=20, gras=True, couleur=URSSAF_BLEU)
    rendu.ecrire(8, 16, 60, 4, "Au service de notre protection sociale", taille=6,
                 couleur=URSSAF_BLEU)
    rendu.ecrire(70, 8, 132, 6, "MICRO-ENTREPRENEUR", taille=12, gras=True,
                 couleur=URSSAF_BLEU, align="C")
    rendu.ecrire(70, 14, 132, 6, "ATTESTATION DE DÉCLARATIONS DE CHIFFRES D'AFFAIRES",
                 taille=9.5, gras=True, couleur=URSSAF_BLEU, align="C")
    rendu.trait(8, 24, 202, couleur=URSSAF_BLEU, epaisseur=0.6)

    # -- Colonne de gauche : références ------------------------------------
    y = 28
    rendu.fond(8, y, 58, 4.4, URSSAF_BLEU_CLAIR)
    rendu.ecrire(9, y, 56, 4.4, "RÉGIME MICRO SOCIAL SIMPLIFIÉ", taille=6.5, gras=True,
                 couleur=URSSAF_BLEU)
    y += 8
    rendu.ecrire(8, y, 58, 4, "Urssaf", taille=8, gras=True, align="R")
    rendu.ecrire(8, y + 4, 58, 4, "Service micro-entrepreneur", taille=7, align="R")

    y += 14
    y = rendu.bandeau(8, y, 58, "VOTRE CONTACT") + 1
    rendu.ecrire(9, y, 56, 4, "Tél. : 3698", taille=7)
    rendu.ecrire(9, y + 4, 56, 4, "autoentrepreneur.urssaf.fr", taille=7)

    y += 12
    y = rendu.bandeau(8, y, 58, "VOS RÉFÉRENCES") + 1
    for libelle, valeur in (
        # Numéros attribués par l'administration : jamais reconstitués.
        ("N° Sécurité Sociale", None),
        ("N° SIRET", emetteur.get("siret")),
        ("N° TI", None),
    ):
        rendu.ecrire(9, y, 30, 4.4, libelle, taille=6.5, gras=True)
        if valeur:
            rendu.ecrire(39, y, 26, 4.4, str(valeur), taille=6.5)
        else:
            rendu.a_remplir(39, y, 26, "à compléter", hauteur=4.4)
        y += 5.4
    rendu.ecrire(9, y, 30, 4.4, "Page", taille=6.5, gras=True)
    rendu.ecrire(39, y, 26, 4.4, "1/1", taille=6.5)

    y += 12
    y = rendu.bandeau(8, y, 58, "CODE DE SÉCURITÉ") + 1
    rendu.a_remplir(9, y, 56, "délivré par l'Urssaf", hauteur=6)
    y += 8
    rendu.paragraphe(
        9, y, 56,
        "L'authenticité d'une attestation se vérifie sur urssaf.fr. Ce document n'émane pas "
        "de l'Urssaf : il est établi à partir de vos pièces et ne porte donc aucun code "
        "vérifiable. Il sert à préparer votre déclaration, pas à la justifier auprès d'un "
        "tiers.",
        taille=6, hauteur=3, couleur=GRIS_TEXTE,
    )

    # -- Colonne de droite : lettre ----------------------------------------
    rendu.ecrire(120, 30, 82, 4, f"Le {_lettres(jour)}", taille=8, align="R")

    # Le nom du compte et la dénomination sont souvent le même nom écrit dans l'autre sens :
    # « Enzo Ciriani » et « CIRIANI ENZO ». L'écrire deux fois donnerait une adresse fautive.
    destinataires = []
    for valeur in (emetteur.get("nom_utilisateur"), emetteur.get("denomination")):
        if valeur and not any(_meme_nom(valeur, deja) for deja in destinataires):
            destinataires.append(str(valeur))
    y = 48
    for valeur in destinataires:
        rendu.ecrire(80, y, 100, 5, valeur.upper(), taille=9)
        y += 5
    adresse = emetteur.get("adresse")
    if adresse:
        rendu.paragraphe(80, y, 100, str(adresse), taille=9, hauteur=4.5)

    y = 76
    rendu.ecrire(72, y, 130, 5, "Madame, Monsieur,", taille=8.5)
    debut_activite = _date_lisible(emetteur.get("date_creation"))
    y = rendu.paragraphe(
        72, y + 8, 130,
        (
            f"Vous avez adhéré au régime micro-entrepreneur le {debut_activite}."
            if debut_activite else
            "Vous relevez du régime micro-entrepreneur."
        ),
        taille=8.5, hauteur=4.4,
    )
    y = rendu.paragraphe(
        72, y + 3, 130,
        f"Le détail des chiffres d'affaires établis au titre de l'année {annee} est indiqué "
        "ci-dessous, à partir des encaissements rapprochés de vos factures.",
        taille=8.5, hauteur=4.4,
    )

    # -- Le tableau --------------------------------------------------------
    y += 6
    colonnes = (
        ("Période", 26, "L"),
        ("Prestations BNC", 26, "C"),
        ("Ventes", 26, "C"),
        ("Prestations BIC", 26, "C"),
        ("LMTC(*)", 26, "C"),
    )
    x0 = 72
    rendu.fond(x0, y, sum(c[1] for c in colonnes), 5.6, URSSAF_BLEU_CLAIR)
    x = x0
    for titre, largeur, _ in colonnes:
        rendu.ecrire(x, y, largeur, 5.6, titre, taille=7, gras=True, couleur=URSSAF_BLEU,
                     align="C")
        rendu.cadre(x, y, largeur, 5.6, couleur=(255, 255, 255), epaisseur=0.3)
        x += largeur
    y += 5.6

    lignes = jeu.ca_mensuel or []
    for index, mois in enumerate(lignes):
        cellules = (
            mois.libelle,
            _montant(mois.prestations_bnc),
            _montant(mois.ventes),
            _montant(mois.prestations_bic),
            _montant(mois.lmtc),
        )
        if index % 2:
            rendu.fond(x0, y, sum(c[1] for c in colonnes), 5.2, (248, 250, 252))
        x = x0
        for (_, largeur, align), valeur in zip(colonnes, cellules):
            rendu.ecrire(x, y, largeur, 5.2, valeur, taille=7,
                         couleur=GRIS_TEXTE if valeur == "-" else NOIR, align=align)
            rendu.cadre(x, y, largeur, 5.2, couleur=(215, 222, 232), epaisseur=0.15)
            x += largeur
        y += 5.2

    y += 2
    rendu.ecrire(x0, y, 130, 4, "« - » = période en cours ou non échue.", taille=6.5,
                 couleur=GRIS_TEXTE)
    rendu.ecrire(x0, y + 4, 130, 4, "(*) Location de meublé de tourisme classé — colonne "
                 "non renseignée : aucune pièce ne permet de la distinguer.", taille=6.5,
                 couleur=GRIS_TEXTE)

    # -- Ce qui est dû sur la période déclarée -----------------------------
    y += 12
    y = rendu.bandeau(
        x0, y, 130,
        f"PÉRIODE DÉCLARÉE — du {_date_lisible(brouillon.periode_debut)} "
        f"au {_date_lisible(brouillon.periode_fin)}",
        fond=URSSAF_BLEU,
    ) + 1.5
    # Le chiffre d'affaires DÉCLARÉ par nature, dans les cases mêmes du téléservice.
    for champ in brouillon.champs:
        if not isinstance(champ.valeur, (int, float)) or isinstance(champ.valeur, bool):
            continue
        rendu.ecrire(x0, y, 90, 5, champ.libelle[:56], taille=7.5)
        rendu.ecrire(x0 + 90, y, 40, 5, _montant(float(champ.valeur)), taille=7.5,
                     gras=True, align="R")
        rendu.trait(x0, y + 5, x0 + 130, couleur=(225, 230, 238))
        y += 5.4

    # Ce qui est dû — calculé par le moteur d'impôt, recopié sans retouche.
    y += 4
    rendu.ecrire(x0, y, 130, 5, "Prélèvements calculés sur cette période", taille=8,
                 gras=True, couleur=URSSAF_BLEU)
    y = _tableau_prelevements(rendu, x0, y + 5.5, 130, jeu.prelevements,
                              fond_entete=URSSAF_BLEU_CLAIR)
    y += 1
    rendu.ecrire(x0, y, 90, 6, "TOTAL À RÉGLER", taille=8.5, gras=True)
    rendu.ecrire(x0 + 90, y, 40, 6, _montant(brouillon.montant_a_payer), taille=9.5,
                 gras=True, align="R")
    y += 8

    y = rendu.paragraphe(
        x0, y, 130,
        "Ces montants sont à déclarer par vos soins sur autoentrepreneur.urssaf.fr, dans le "
        "délai propre à votre périodicité. L'assiette retenue est le chiffre d'affaires "
        "ENCAISSÉ : seuls les virements reçus et rapprochés d'une facture émise y figurent.",
        taille=6.8, hauteur=3.4, couleur=GRIS_TEXTE,
    )

    if brouillon.points_de_vigilance:
        y += 2
        for point in brouillon.points_de_vigilance:
            y = rendu.paragraphe(x0, y, 130, f"• {point}", taille=6.2, hauteur=3,
                                 couleur=(170, 120, 40))

    _bloc_visa(rendu, max(y + 4, 240), encre=URSSAF_BLEU, largeur=130, x0=x0)
    _pied_reproduction(rendu)


# ================================================================ 2. CERFA 2042
def page_cerfa_2042(pdf, rendu: _Rendu, jeu: JeuDeclarations, brouillon: Brouillon,
                    emetteur: Dict[str, Any]) -> None:
    """Déclaration des revenus — cerfa n°10330*30.

    La page de garde du 2042 ne porte aucun chiffre d'affaires : elle porte l'identité du
    foyer. Les montants de micro-entreprise vont sur l'annexe 2042-C-PRO, reproduite juste
    en dessous — les séparer évite de laisser croire qu'un CA se reporte sur la garde.

    Presque tout l'état civil est ici inconnu de la plateforme : elle connaît une entreprise,
    pas un foyer fiscal. Ces zones restent donc à remplir, comme sur l'imprimé vierge.
    """
    jour = date_du_jour()
    annee_revenus = int(str(jeu.date_debut)[:4])

    # -- En-tête -----------------------------------------------------------
    rendu.cadre(8, 8, 26, 18, couleur=CERFA_BLEU, epaisseur=0.4)
    rendu.ecrire(8, 9, 26, 4, str(annee_revenus), taille=7, align="C", couleur=CERFA_BLEU)
    rendu.ecrire(8, 13, 26, 5, "cerfa", taille=11, gras=True, align="C",
                 couleur=CERFA_BLEU)
    rendu.ecrire(8, 19, 26, 4, "N°10330 * 30", taille=6, align="C", couleur=CERFA_BLEU)

    rendu.ecrire(38, 8, 164, 11, f"DÉCLARATION DES REVENUS {annee_revenus}", taille=19,
                 couleur=CERFA_BLEU)
    rendu.ecrire(38, 20, 60, 5, "RÉPUBLIQUE FRANÇAISE", taille=7, gras=True,
                 couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(38, 24.5, 164, 4, "DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES", taille=6.5,
                 couleur=CERFA_BLEU_TITRE)

    # -- Bloc numéros fiscaux ---------------------------------------------
    y = 32
    rendu.fond(8, y, 194, 20, CERFA_BLEU_PALE)
    rendu.ecrire(10, y + 1, 120, 4.5, "Vous déposez une déclaration pour la première fois :",
                 taille=7.5, gras=True, couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(130, y + 1, 20, 4.5, "cochez", taille=7.5, couleur=CERFA_BLEU_TITRE)
    rendu.case_a_cocher(152, y + 1.4)
    for index, libelle in enumerate(("N° FIP", "N° fiscal", "N° fiscal du conjoint")):
        ligne_y = y + 6.5 + index * 4.4
        rendu.ecrire(10, ligne_y, 60, 4, libelle, taille=7, couleur=CERFA_BLEU_TITRE,
                     align="R")
        # Numéros attribués par la DGFiP : la plateforme ne les connaît pas.
        rendu.a_remplir(74, ligne_y, 60, "", hauteur=3.8)

    # -- État civil --------------------------------------------------------
    y = 56
    y = rendu.bandeau(8, y, 194, "ÉTAT CIVIL", fond=(255, 255, 255),
                      encre=CERFA_BLEU_TITRE, hauteur=5, taille=8.5)
    rendu.trait(8, y, 202, couleur=CERFA_BLEU, epaisseur=0.4)
    y += 1.5
    rendu.ecrire(8, y, 90, 4.5, "DÉCLARANT 1", taille=7, gras=True, couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(106, y, 90, 4.5, "DÉCLARANT 2", taille=7, gras=True,
                 couleur=CERFA_BLEU_TITRE)
    y += 5.5

    # Le nom du compte est le seul état civil connu ; le reste appartient au foyer fiscal.
    nom_compte = emetteur.get("nom_utilisateur")
    for libelle, valeur in (
        ("Nom de naissance", nom_compte),
        ("Prénoms", None),
        ("Date de naissance", None),
        ("Lieu de naissance", None),
        ("Votre téléphone", None),
        ("Votre mél", emetteur.get("email")),
    ):
        rendu.ecrire(8, y, 34, 4.6, libelle, taille=7, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(43, y, 55, valeur, taille=7.5)
        rendu.valeur_ou_vide(106, y, 55, None)
        y += 5.4

    # -- Adresse -----------------------------------------------------------
    y += 2
    y = rendu.bandeau(8, y, 194, f"ADRESSE AU 1ER JANVIER {annee_revenus + 1}",
                      fond=(255, 255, 255), encre=CERFA_BLEU_TITRE, hauteur=5, taille=8.5)
    rendu.trait(8, y, 202, couleur=CERFA_BLEU, epaisseur=0.4)
    y += 2
    rendu.ecrire(8, y, 34, 4.6, "Adresse", taille=7, couleur=GRIS_TEXTE)
    # L'adresse connue est celle de l'ENTREPRISE : au domicile pour beaucoup de
    # micro-entrepreneurs, mais pas pour tous. D'où la réserve portée en regard.
    rendu.valeur_ou_vide(43, y, 155, emetteur.get("adresse"), taille=7.5)
    y += 5.4
    rendu.ecrire(43, y, 155, 4, "Adresse de l'entreprise — le 2042 attend celle du FOYER : "
                 "corrigez-la si elles diffèrent.", taille=6, couleur=(170, 120, 40))
    y += 6
    for libelle in ("Code postal", "Commune"):
        rendu.ecrire(8, y, 34, 4.6, libelle, taille=7, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(43, y, 60, None)
        y += 5.4

    # -- Changements d'adresse --------------------------------------------
    y += 1
    y = rendu.bandeau(8, y, 194, "CHANGEMENTS D'ADRESSE", fond=(255, 255, 255),
                      encre=CERFA_BLEU_TITRE, hauteur=5, taille=8.5)
    rendu.trait(8, y, 202, couleur=CERFA_BLEU, epaisseur=0.4)
    y += 2
    for annee_demenagement in (annee_revenus, annee_revenus + 1):
        rendu.ecrire(8, y, 70, 4.6, f"Vous avez changé d'adresse en {annee_demenagement}",
                     taille=7.5, gras=True, couleur=CERFA_BLEU_TITRE)
        rendu.ecrire(82, y, 34, 4.6, "Date du déménagement", taille=7, couleur=GRIS_TEXTE)
        rendu.a_remplir(118, y, 40, "", hauteur=4.4)
        y += 5.6
        rendu.ecrire(8, y, 34, 4.6, "Adresse", taille=7, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(43, y, 155, None)
        y += 6.4

    # -- Revenus micro : l'annexe 2042-C-PRO -------------------------------
    y += 3
    y = rendu.bandeau(
        8, y, 194,
        "ANNEXE 2042-C-PRO — REVENUS INDUSTRIELS ET COMMERCIAUX / NON COMMERCIAUX "
        "PROFESSIONNELS (RÉGIME MICRO)",
        fond=CERFA_BLEU, hauteur=5.4, taille=7.5,
    )
    y += 1.5
    rendu.ecrire(8, y, 22, 5, "Case", taille=7, gras=True, couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(30, y, 128, 5, "Libellé officiel", taille=7, gras=True,
                 couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(158, y, 44, 5, "Montant BRUT", taille=7, gras=True,
                 couleur=CERFA_BLEU_TITRE, align="R")
    y += 5
    rendu.trait(8, y, 202, couleur=CERFA_BLEU, epaisseur=0.3)
    y += 1

    cases = [c for c in brouillon.champs if c.case]
    if not cases:
        rendu.ecrire(8, y, 194, 5, "Aucun chiffre d'affaires encaissé sur la période — la "
                     "déclaration reste due, à 0 €.", taille=7.5, couleur=GRIS_TEXTE)
        y += 6
    for champ in cases:
        rendu.cadre(8, y, 20, 5.4, couleur=CERFA_BLEU, epaisseur=0.3)
        rendu.ecrire(8, y, 20, 5.4, champ.case or "", taille=8, gras=True, align="C",
                     couleur=CERFA_BLEU_TITRE)
        rendu.ecrire(30, y, 128, 5.4, champ.libelle[:78], taille=7)
        valeur = champ.valeur if isinstance(champ.valeur, (int, float)) else None
        rendu.ecrire(158, y, 44, 5.4, _montant(valeur), taille=8, gras=True, align="R")
        y += 6

    y += 1
    rendu.ecrire(8, y, 194, 4, "Le montant reporté est le CA BRUT : l'abattement forfaitaire "
                 "est appliqué par l'administration, ne le déduisez jamais vous-même.",
                 taille=6.5, couleur=(170, 120, 40))

    # -- Signature ---------------------------------------------------------
    # Ancrée en bas de page comme sur l'imprimé, mais au-dessus de la mention de
    # reproduction : deux blocs superposés rendraient l'un et l'autre illisibles.
    y = 248
    rendu.bandeau(8, y, 194, "SIGNATURE DU OU DES DÉCLARANTS", fond=(255, 255, 255),
                  encre=CERFA_BLEU_TITRE, hauteur=5, taille=8.5)
    rendu.trait(8, y + 5, 202, couleur=CERFA_BLEU, epaisseur=0.4)
    rendu.cadre(8, y + 6, 194, 24, couleur=CERFA_BLEU, epaisseur=0.3)
    rendu.ecrire(11, y + 8, 10, 4.5, "À", taille=7.5, couleur=GRIS_TEXTE)
    rendu.valeur_ou_vide(18, y + 8, 50, None)
    rendu.ecrire(72, y + 8, 10, 4.5, "Le", taille=7.5, couleur=GRIS_TEXTE)
    rendu.ecrire(80, y + 8, 40, 4.5, _jjmmaaaa(jour), taille=8, gras=True)
    rendu.ecrire(11, y + 18, 90, 4.5, "Signature", taille=7.5, couleur=GRIS_TEXTE)
    rendu.trait(30, y + 22.5, 100, couleur=(200, 205, 215))
    # Case ØTA de l'imprimé : c'est par elle que l'expert-comptable engage sa responsabilité
    # sur une déclaration déposée au titre d'un mandat.
    rendu.paragraphe(120, y + 8, 66, "Si vous déposez la déclaration au titre d'un mandat, "
                     "apposez votre cachet et cochez", taille=6.5, hauteur=3.2)
    rendu.ecrire(120, y + 18, 12, 4.5, "ØTA", taille=7, gras=True, couleur=CERFA_BLEU_TITRE)
    rendu.case_a_cocher(134, y + 18.4)
    rendu.ecrire(142, y + 18, 58, 4.5, "cachet du cabinet", taille=6, couleur=GRIS_TEXTE)

    _pied_reproduction(rendu)


# ============================================================== 3. CERFA 1447-C-SD
def page_cerfa_1447c(pdf, rendu: _Rendu, jeu: JeuDeclarations, brouillon: Brouillon,
                     emetteur: Dict[str, Any]) -> None:
    """Cotisation foncière des entreprises — n° 1447-C-SD, cerfa n°14187*16.

    Formulaire obligatoire de l'article 1477-II du CGI. Il ne se remplit qu'UNE FOIS, à la
    création de l'établissement — d'où l'absence de tout montant : la CFE est calculée par
    l'administration sur un barème voté commune par commune, jamais par le déclarant.
    """
    jour = date_du_jour()
    annee = jour.year

    # -- En-tête -----------------------------------------------------------
    rendu.ecrire(8, 8, 40, 5, "RÉPUBLIQUE", taille=8, gras=True)
    rendu.ecrire(8, 12, 40, 5, "FRANÇAISE", taille=8, gras=True)
    rendu.ecrire(8, 17, 40, 4, "Liberté · Égalité · Fraternité", taille=5.5,
                 couleur=GRIS_TEXTE)

    rendu.ecrire(56, 8, 96, 4, "Formulaire obligatoire", taille=7, align="C")
    rendu.ecrire(56, 11.5, 96, 4, "(art. 1477-II du code général des impôts)", taille=6.5,
                 align="C")
    rendu.ecrire(56, 17, 96, 4, "DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES", taille=6.5,
                 align="C")
    rendu.ecrire(152, 8, 50, 5, "N° 1447-C-SD", taille=9, gras=True, align="R")
    rendu.ecrire(152, 14, 50, 5, "cerfa", taille=9, gras=True, align="R",
                 couleur=CERFA_BLEU)
    rendu.ecrire(152, 19, 50, 4, "N° 14187*16", taille=6.5, align="R")

    rendu.ecrire(8, 26, 194, 7, f"COTISATION FONCIÈRE DES ENTREPRISES {annee}", taille=13,
                 gras=True, align="C")

    rendu.fond(8, 36, 22, 8, NOIR)
    rendu.ecrire(8, 36, 22, 8, "CFE", taille=12, gras=True, couleur=(255, 255, 255),
                 align="C")
    rendu.ecrire(8, 32, 22, 4, "FISCALITÉ DIRECTE LOCALE", taille=4.5, align="C")

    # -- Déclaration initiale ---------------------------------------------
    rendu.ecrire(40, 36, 120, 4.5, "DÉCLARATION INITIALE", taille=8, gras=True, align="C")
    rendu.ecrire(40, 40, 120, 4, "en cas de création d'établissement ou de changement "
                 f"d'exploitant intervenu en {annee - 1}", taille=6.5, align="C")

    y = 48
    for libelle, valeur, largeur in (
        ("DÉPARTEMENT", None, 60),
        ("COMMUNE DU LIEU D'IMPOSITION", None, 60),
    ):
        rendu.cadre(8, y, 42, 8)
        rendu.ecrire(9, y, 40, 8, libelle, taille=6, align="C")
        rendu.cadre(50, y, largeur, 8)
        rendu.valeur_ou_vide(52, y + 1.5, largeur - 4, valeur)
        y += 8
    rendu.cadre(8, y, 102, 12)
    rendu.ecrire(9, y, 100, 12, "TIMBRE À DATE DU SERVICE", taille=6, align="C",
                 couleur=GRIS_TEXTE)

    rendu.paragraphe(
        116, 48, 86,
        f"Renvoyez un exemplaire AVANT LE 1er JANVIER {annee + 1} au service des impôts des "
        "entreprises dont dépend l'établissement, auquel vous pouvez vous adresser pour tout "
        "renseignement.",
        taille=6.5, hauteur=3.4,
    )
    rendu.cadre(116, 62, 86, 6)
    rendu.ecrire(117, 62, 84, 6, "ACCUEIL : horaires disponibles sur impots.gouv.fr",
                 taille=6.5)

    # -- Cadre A1 : identification de l'entreprise -------------------------
    y = 76
    rendu.fond(8, y, 194, 5.6, NOIR)
    rendu.ecrire(9, y, 10, 5.6, "A1", taille=8, gras=True, couleur=(255, 255, 255))
    rendu.ecrire(20, y, 90, 5.6, "Identification de l'entreprise", taille=8, gras=True,
                 couleur=(255, 255, 255))
    rendu.ecrire(110, y, 91, 5.6, "COMPLÉTER ou RECTIFIER les mentions absentes ou erronées",
                 taille=6, couleur=(230, 230, 230), align="R")
    y += 5.6

    artisan = emetteur.get("artisan")
    rubriques: List[tuple] = [
        (1, "Dénomination ou nom et prénom",
         emetteur.get("denomination") or emetteur.get("nom_utilisateur")),
        (2, "Activités exercées", emetteur.get("activite")),
        (3, "Adresse dans la commune", emetteur.get("adresse")),
        (4, "Adresse où doit être envoyé l'avis d'imposition",
         emetteur.get("adresse_registre") or emetteur.get("adresse")),
        (5, "Numéro SIRET de l'établissement", emetteur.get("siret")),
        (6, "Code de l'activité de l'établissement (NACE)", emetteur.get("code_ape")),
    ]
    for numero, libelle, valeur in rubriques:
        rendu.fond(8, y, 194, 4.4, (225, 225, 228))
        rendu.ecrire(9, y, 192, 4.4, libelle, taille=6.8, gras=True)
        y += 4.4
        rendu.cadre(8, y, 194, 6.2)
        rendu.fond(96, y, 6, 6.2, (200, 200, 205))
        rendu.ecrire(96, y, 6, 6.2, str(numero), taille=7, align="C")
        rendu.valeur_ou_vide(104, y + 0.6, 96, str(valeur) if valeur else None, taille=7.5)
        y += 6.2

    # Rubrique 7 : deux cases exclusives, jamais cochées au hasard.
    rendu.fond(8, y, 194, 4.4, (225, 225, 228))
    rendu.ecrire(9, y, 192, 4.4, "Inscription au registre national des entreprises en tant "
                 "qu'entreprise du secteur des métiers et de l'artisanat", taille=6.8,
                 gras=True)
    y += 4.4
    rendu.cadre(8, y, 194, 6.2)
    rendu.fond(96, y, 6, 6.2, (200, 200, 205))
    rendu.ecrire(96, y, 6, 6.2, "7", taille=7, align="C")
    rendu.case_a_cocher(120, y + 1.3, cochee=artisan is True)
    rendu.ecrire(125, y, 14, 6.2, "OUI", taille=7)
    rendu.case_a_cocher(148, y + 1.3, cochee=artisan is False)
    rendu.ecrire(153, y, 14, 6.2, "NON", taille=7)
    if artisan is None:
        rendu.ecrire(168, y, 34, 6.2, "à compléter", taille=6, couleur=(160, 165, 175))
    y += 6.2

    # -- Comptable ---------------------------------------------------------
    rendu.fond(8, y, 194, 4.4, (225, 225, 228))
    rendu.ecrire(9, y, 192, 4.4, "Comptable de l'entreprise (nom, adresse, téléphone, "
                 "adresse électronique)", taille=6.8, gras=True)
    y += 4.4
    rendu.cadre(8, y, 194, 18)
    for index, libelle in enumerate(("Nom :", "Adresse :", "Numéro de téléphone :",
                                     "Adresse électronique :")):
        rendu.ecrire(10, y + 0.6 + index * 4.2, 40, 4, libelle, taille=6.8,
                     couleur=GRIS_TEXTE)
        rendu.trait(48, y + 4.4 + index * 4.2, 198, couleur=(210, 215, 225))
    y += 18

    # -- Cadre A2 ----------------------------------------------------------
    rendu.fond(8, y, 194, 5.6, NOIR)
    rendu.ecrire(9, y, 10, 5.6, "A2", taille=8, gras=True, couleur=(255, 255, 255))
    rendu.ecrire(20, y, 180, 5.6, "Activité professionnelle exercée de mon domicile ou "
                 "exercée en clientèle", taille=8, gras=True, couleur=(255, 255, 255))
    y += 5.6

    rendu.cadre(8, y, 100, 12)
    rendu.ecrire(10, y + 1, 82, 5, "Si vous ne disposez d'aucun autre local, cochez la case",
                 taille=6.8)
    rendu.case_a_cocher(94, y + 2)
    rendu.cadre(108, y, 94, 12)
    rendu.ecrire(110, y + 1, 90, 4.5, "Précisez la surface occupée pour les besoins de "
                 "l'activité exercée à domicile :", taille=6.5)
    rendu.trait(112, y + 9, 180, couleur=(210, 215, 225))
    rendu.ecrire(182, y + 5.5, 16, 5, "m²", taille=7)
    y += 12

    rendu.cadre(8, y, 100, 22)
    rendu.paragraphe(10, y + 1, 96, "Nom et adresse de la personne ayant établi la "
                     "déclaration si elle ne fait pas partie du personnel salarié de "
                     "l'entreprise.", taille=6.5, hauteur=3.2)
    rendu.ecrire(10, y + 12, 40, 4, "Téléphone :", taille=6.5, couleur=GRIS_TEXTE)
    rendu.ecrire(10, y + 16.5, 40, 4, "Adresse électronique :", taille=6.5,
                 couleur=GRIS_TEXTE)
    rendu.cadre(108, y, 94, 22)
    rendu.ecrire(110, y + 1, 10, 4.5, "À", taille=7, couleur=GRIS_TEXTE)
    rendu.trait(116, y + 5, 150, couleur=(210, 215, 225))
    rendu.ecrire(152, y + 1, 8, 4.5, "le", taille=7, couleur=GRIS_TEXTE)
    rendu.ecrire(158, y + 1, 42, 4.5, _jjmmaaaa(jour), taille=7.5, gras=True)
    rendu.ecrire(110, y + 8, 40, 4.5, "Signature", taille=7, couleur=GRIS_TEXTE)
    rendu.trait(110, y + 18, 198, couleur=(210, 215, 225))
    y += 22

    # -- Ce que la plateforme ne calcule pas -------------------------------
    y += 3
    rendu.paragraphe(
        8, y, 194,
        "Aucun montant ne figure sur ce formulaire : la CFE est calculée par l'administration "
        "sur un barème voté par la COMMUNE, à partir de la base minimum applicable au chiffre "
        "d'affaires. Le formulaire 1447-C-SD ne se dépose qu'une fois, à la création de "
        "l'établissement.",
        taille=6.8, hauteur=3.4, couleur=GRIS_TEXTE,
    )

    _pied_reproduction(rendu)


def _pied_reproduction(rendu: _Rendu) -> None:
    """Mention portée au bas de chaque reproduction — jamais optionnelle."""
    rendu.trait(8, 286, 202, couleur=(210, 215, 225))
    rendu.paragraphe(8, 287, 194, _MENTION_REPRODUCTION, taille=5.8, hauteur=3,
                     couleur=GRIS_TEXTE)


def _bloc_visa(rendu: _Rendu, y: float, *, encre=NOIR, largeur: float = 194,
               x0: float = 8) -> float:
    """Attestation du déclarant et visa de l'expert-comptable, côte à côte.

    Deux signatures distinctes, et c'est le fond du document : le déclarant atteste de
    l'exactitude de ses pièces, l'expert-comptable vise ce qu'il a vérifié. Les confondre
    ferait porter à l'un la responsabilité de l'autre.

    Les imprimés qui portent déjà leur propre cadre de signature — le 2042, le 1447-C-SD —
    n'appellent pas ce bloc : le leur fait foi.
    """
    demi = (largeur - 6) / 2
    for index, (titre, lignes) in enumerate([
        ("LE DÉCLARANT", ("Nom et qualité", "Fait à", "Le", "Signature")),
        ("L'EXPERT-COMPTABLE", ("Nom et n° d'inscription à l'Ordre", "Cabinet", "Le",
                               "Signature et cachet")),
    ]):
        x = x0 + index * (demi + 6)
        rendu.cadre(x, y, demi, 34, couleur=encre, epaisseur=0.3)
        rendu.ecrire(x + 3, y + 1, demi - 6, 4.5, titre, taille=7, gras=True, couleur=encre)
        for rang, libelle in enumerate(lignes):
            ligne_y = y + 7 + rang * 6.6
            rendu.ecrire(x + 3, ligne_y, demi - 6, 4, libelle, taille=6.2,
                         couleur=GRIS_TEXTE)
            rendu.trait(x + 3, ligne_y + 5.4, x + demi - 3, couleur=(205, 210, 220))
    return y + 34


def _tableau_prelevements(rendu: _Rendu, x0: float, y: float, largeur: float,
                          prelevements: Dict[str, Any], *, fond_entete) -> float:
    """Le détail de ce qui est dû, tel que le téléservice l'affiche après déclaration.

    Recopié du moteur d'impôt sans retouche : les taux gardent leur pleine précision, les
    montants leurs deux décimales.
    """
    colonnes = ((largeur - 96, "L"), (32, "R"), (28, "R"), (36, "R"))
    entetes = ("Prélèvement", "Assiette", "Taux", "Montant")

    rendu.fond(x0, y, largeur, 5.2, fond_entete)
    x = x0
    for (col_largeur, align), entete in zip(colonnes, entetes):
        rendu.ecrire(x, y, col_largeur, 5.2, entete, taille=6.8, gras=True, align=align)
        x += col_largeur
    y += 5.2

    def ligne(libelle: str, assiette: Optional[float], taux: Optional[float],
              montant: Optional[float]) -> None:
        nonlocal y
        x = x0
        for (col_largeur, align), valeur in zip(
            colonnes, (libelle, _montant(assiette), _pct(taux), _montant(montant))
        ):
            rendu.ecrire(x, y, col_largeur, 5, valeur, taille=6.8, align=align)
            x += col_largeur
        rendu.trait(x0, y + 5, x0 + largeur, couleur=(225, 230, 238))
        y += 5

    for poste in prelevements.get("postes") or []:
        categorie = poste.get("categorie", "")
        ligne(f"Cotisations sociales — {categorie}", poste.get("ca"),
              poste.get("taux_cotisations"), poste.get("cotisations_sociales"))
        libelle_cfp = "Formation professionnelle (CFP)"
        if poste.get("cfp_exoneree"):
            libelle_cfp += " — exonérée"
        ligne(libelle_cfp, poste.get("ca"), poste.get("taux_cfp"), poste.get("cfp"))
        if poste.get("tfcc_applicable"):
            ligne("Chambre consulaire (TFCC)", poste.get("ca"), poste.get("taux_tfcc"),
                  poste.get("tfcc"))
        if poste.get("versement_liberatoire") is not None:
            ligne("Versement libératoire de l'impôt", poste.get("ca"),
                  poste.get("taux_versement_liberatoire"), poste.get("versement_liberatoire"))
    return y


# ==================================================================== 4. DES
def page_des(pdf, rendu: _Rendu, jeu: JeuDeclarations, brouillon: Brouillon,
             emetteur: Dict[str, Any]) -> None:
    """Déclaration européenne de services — téléservice Prodouane.

    Il n'existe pas d'imprimé CERFA : la DES se saisit en ligne. La page reproduit donc les
    champs de l'interface, dans leur ordre, un preneur par ligne.

    Ce qu'elle ne fera jamais : compléter le n° de TVA du preneur. Il figure sur la facture
    ou sur le relevé de la plateforme, pas sur le virement reçu — la plateforme ne peut que
    le laisser à remplir.
    """
    jour = date_du_jour()

    rendu.ecrire(8, 8, 40, 5, "RÉPUBLIQUE", taille=8, gras=True)
    rendu.ecrire(8, 12, 40, 5, "FRANÇAISE", taille=8, gras=True)
    rendu.ecrire(8, 19, 194, 7, "DÉCLARATION EUROPÉENNE DE SERVICES", taille=14, gras=True,
                 align="C", couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(8, 27, 194, 5, "Direction générale des douanes et droits indirects — "
                 "téléservice Prodouane (douane.gouv.fr)", taille=7.5, align="C",
                 couleur=GRIS_TEXTE)
    rendu.trait(8, 34, 202, couleur=CERFA_BLEU, epaisseur=0.5)

    y = 40
    y = rendu.bandeau(8, y, 194, "IDENTIFICATION DU DÉCLARANT", fond=CERFA_BLEU) + 2
    for libelle, valeur in (
        ("Dénomination", emetteur.get("denomination")),
        ("N° de TVA intracommunautaire", emetteur.get("numero_tva_intracom")),
        ("Période déclarée", f"du {_date_lisible(brouillon.periode_debut)} au "
                             f"{_date_lisible(brouillon.periode_fin)}"),
    ):
        rendu.ecrire(8, y, 60, 5, libelle, taille=7.5, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(70, y, 132, str(valeur) if valeur else None, gras=True)
        y += 6.4

    if not emetteur.get("numero_tva_intracom"):
        y = rendu.paragraphe(
            8, y, 194,
            "Le n° de TVA intracommunautaire est OBLIGATOIRE pour déposer une DES. Il "
            "s'obtient gratuitement auprès du service des impôts des entreprises ; sans lui, "
            "certaines plateformes ne peuvent même pas activer le paiement.",
            taille=6.8, hauteur=3.4, couleur=(170, 120, 40),
        ) + 2

    # -- Un preneur par ligne ---------------------------------------------
    y += 3
    y = rendu.bandeau(8, y, 194, "SERVICES FOURNIS À DES PRENEURS ÉTABLIS DANS L'UNION "
                      "EUROPÉENNE", fond=CERFA_BLEU) + 1
    colonnes = ((74, "L"), (26, "L"), (52, "L"), (42, "R"))
    entetes = ("Preneur", "Pays", "N° de TVA du preneur", "Montant HT")
    rendu.fond(8, y, 194, 5.2, CERFA_BLEU_PALE)
    x = 8
    for (largeur, align), entete in zip(colonnes, entetes):
        rendu.ecrire(x, y, largeur, 5.2, entete, taille=6.8, gras=True, align=align,
                     couleur=CERFA_BLEU_TITRE)
        x += largeur
    y += 5.2

    if not jeu.revenus_ue:
        rendu.ecrire(8, y, 194, 6, "Aucun encaissement provenant d'une entité établie dans "
                     "l'Union européenne sur la période.", taille=7.5, couleur=GRIS_TEXTE)
        y += 8
    else:
        from . import revenus_ue as ue  # noqa: PLC0415 — regroupement, pas de calcul

        for groupe in ue.par_contrepartie(jeu.revenus_ue).values():
            x = 8
            cellules = (
                (groupe["contrepartie"] or "—")[:44]
                + ("" if groupe["certain"] else "  (à confirmer)"),
                groupe["pays"] or "à compléter",
                "",  # jamais détectable depuis un virement
                _montant(groupe["montant_eur"]),
            )
            for (largeur, align), valeur in zip(colonnes, cellules):
                if valeur:
                    rendu.ecrire(x, y, largeur, 5.4, valeur, taille=7, align=align)
                else:
                    rendu.a_remplir(x, y + 0.4, largeur - 4, "sur la facture du preneur",
                                    hauteur=4.6)
                x += largeur
            rendu.trait(8, y + 5.4, 202, couleur=(225, 230, 238))
            y += 5.8

        y += 1
        rendu.ecrire(8, y, 152, 6, "TOTAL DES SERVICES DÉCLARÉS", taille=8, gras=True)
        rendu.ecrire(160, y, 42, 6, _montant(
            round(sum(r.montant_eur for r in jeu.revenus_ue), 2)
        ), taille=9, gras=True, align="R")
        y += 9

    y = rendu.paragraphe(
        8, y, 194,
        "La DES ne donne lieu à AUCUN paiement : c'est une déclaration informative, destinée "
        "au recoupement entre administrations. Elle reste due même sous franchise de TVA "
        "nationale, et son omission est traitée comme une infraction fiscale. Échéance : au "
        "plus tard le 10e jour ouvrable du mois suivant.",
        taille=6.8, hauteur=3.4, couleur=GRIS_TEXTE,
    )

    for point in brouillon.points_de_vigilance:
        y = rendu.paragraphe(8, y + 1, 194, f"• {point}", taille=6.2, hauteur=3,
                             couleur=(170, 120, 40))

    rendu.ecrire(8, 236, 194, 5, f"Établi le {_lettres(jour)}", taille=7,
                 couleur=GRIS_TEXTE)
    _bloc_visa(rendu, 242, encre=CERFA_BLEU)
    _pied_reproduction(rendu)


# ==================================================================== 5. CA3
def page_ca3(pdf, rendu: _Rendu, jeu: JeuDeclarations, brouillon: Brouillon,
             emetteur: Dict[str, Any]) -> None:
    """Déclaration de TVA — structure du 3310-CA3, SANS numéros de case.

    Le guide est explicite : les numéros de case du CA3 n'ont pas été confirmés. Les
    afficher donnerait à une supposition l'apparence d'une référence, et c'est précisément
    ce que la spécification interdit. La page reproduit donc la LOGIQUE du formulaire —
    collectée, déductible, net à payer — et dit ce qu'elle ne sait pas.
    """
    jour = date_du_jour()

    rendu.ecrire(8, 8, 40, 5, "RÉPUBLIQUE", taille=8, gras=True)
    rendu.ecrire(8, 12, 40, 5, "FRANÇAISE", taille=8, gras=True)
    rendu.ecrire(152, 8, 50, 5, "N° 3310-CA3", taille=9, gras=True, align="R")
    rendu.ecrire(8, 19, 194, 7, "DÉCLARATION DE TAXE SUR LA VALEUR AJOUTÉE", taille=13,
                 gras=True, align="C", couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(8, 27, 194, 5, "Direction générale des finances publiques — espace "
                 "professionnel impots.gouv.fr", taille=7.5, align="C", couleur=GRIS_TEXTE)
    rendu.trait(8, 34, 202, couleur=CERFA_BLEU, epaisseur=0.5)

    # La réserve d'abord : elle conditionne la lecture de tout le reste.
    y = 38
    rendu.fond(8, y, 194, 13, (252, 243, 224))
    rendu.paragraphe(
        10, y + 1, 190,
        "NUMÉROS DE CASE NON RECOUPÉS — la structure ci-dessous suit la logique du formulaire, "
        "mais les références exactes du 3310-CA3 en vigueur n'ont pas été vérifiées. Relevez-les "
        "sur le formulaire officiel avant de reporter quoi que ce soit.",
        taille=6.8, hauteur=3.4, couleur=(150, 100, 20),
    )
    y += 16

    y = rendu.bandeau(8, y, 194, "IDENTIFICATION DU REDEVABLE", fond=CERFA_BLEU) + 2
    for libelle, valeur in (
        ("Dénomination", emetteur.get("denomination")),
        ("SIREN", emetteur.get("siren")),
        ("N° de TVA intracommunautaire", emetteur.get("numero_tva_intracom")),
        ("Période déclarée", f"du {_date_lisible(brouillon.periode_debut)} au "
                             f"{_date_lisible(brouillon.periode_fin)}"),
    ):
        rendu.ecrire(8, y, 60, 5, libelle, taille=7.5, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(70, y, 132, str(valeur) if valeur else None, gras=True)
        y += 6.4

    collectee = jeu.tva_collectee or {}
    deductible = jeu.tva_deductible or {}
    nette = None
    if collectee.get("total") is not None and deductible.get("total") is not None:
        nette = round(float(collectee["total"]) - float(deductible["total"]), 2)

    y += 3
    y = rendu.bandeau(8, y, 194, "A — TVA BRUTE DUE", fond=CERFA_BLEU) + 1.5
    for libelle, valeur in (
        ("Base hors taxe des opérations imposables", collectee.get("base_ht")),
        ("TVA collectée sur les factures émises", collectee.get("total")),
    ):
        rendu.ecrire(8, y, 150, 5, libelle, taille=7.5)
        rendu.ecrire(158, y, 44, 5, _montant(valeur), taille=8, gras=True, align="R")
        rendu.trait(8, y + 5, 202, couleur=(225, 230, 238))
        y += 5.6

    y += 3
    y = rendu.bandeau(8, y, 194, "B — TVA DÉDUCTIBLE", fond=CERFA_BLEU) + 1.5
    rendu.ecrire(8, y, 150, 5, "TVA supportée sur les achats professionnels", taille=7.5)
    rendu.ecrire(158, y, 44, 5, _montant(deductible.get("total")), taille=8, gras=True,
                 align="R")
    rendu.trait(8, y + 5, 202, couleur=(225, 230, 238))
    y += 6.5
    y = rendu.paragraphe(8, y, 194, deductible.get("reserve", ""), taille=6.5, hauteur=3.2,
                         couleur=(170, 120, 40))
    if deductible.get("pieces_sans_tva_lue"):
        y = rendu.paragraphe(
            8, y, 194,
            f"{deductible['pieces_sans_tva_lue']} facture(s) reçue(s) sans TVA lisible ne "
            "sont PAS comptées : un montant illisible n'est pas un montant nul.",
            taille=6.5, hauteur=3.2, couleur=(170, 120, 40),
        )

    y += 4
    rendu.fond(8, y, 194, 8, CERFA_BLEU_PALE)
    rendu.ecrire(10, y, 148, 8, "C — TVA NETTE À PAYER  (A − B)", taille=8.5, gras=True,
                 couleur=CERFA_BLEU_TITRE)
    rendu.ecrire(158, y, 42, 8, _montant(nette), taille=10, gras=True, align="R",
                 couleur=CERFA_BLEU_TITRE)
    y += 12

    for point in brouillon.points_de_vigilance:
        y = rendu.paragraphe(8, y, 194, f"• {point}", taille=6.2, hauteur=3,
                             couleur=(170, 120, 40))

    rendu.ecrire(8, 236, 194, 5, f"Établi le {_lettres(jour)}", taille=7,
                 couleur=GRIS_TEXTE)
    _bloc_visa(rendu, 242, encre=CERFA_BLEU)
    _pied_reproduction(rendu)


# ============================================== Déclaration non applicable
def page_non_applicable(pdf, rendu: _Rendu, jeu: JeuDeclarations, brouillon: Brouillon,
                        emetteur: Dict[str, Any]) -> None:
    """Une déclaration qui ne s'applique pas se justifie ; elle ne disparaît pas.

    Reproduire un imprimé vide n'apprendrait rien. Ce qui compte ici est le MOTIF : c'est
    lui que l'expert-comptable vérifie, et lui qui protège en cas de contrôle.
    """
    jour = date_du_jour()

    rendu.ecrire(8, 8, 40, 5, "RÉPUBLIQUE", taille=8, gras=True)
    rendu.ecrire(8, 12, 40, 5, "FRANÇAISE", taille=8, gras=True)
    rendu.ecrire(8, 22, 194, 7, brouillon.titre.upper(), taille=12, gras=True, align="C",
                 couleur=CERFA_BLEU_TITRE)
    rendu.trait(8, 32, 202, couleur=CERFA_BLEU, epaisseur=0.5)

    y = 40
    y = rendu.bandeau(8, y, 194, "DÉCLARATION SANS OBJET SUR CETTE PÉRIODE",
                      fond=CERFA_BLEU) + 3
    for libelle, valeur in (
        ("Déclarant", emetteur.get("denomination") or emetteur.get("nom_utilisateur")),
        ("SIREN", emetteur.get("siren")),
        ("Période", f"du {_date_lisible(brouillon.periode_debut)} au "
                    f"{_date_lisible(brouillon.periode_fin)}"),
    ):
        rendu.ecrire(8, y, 60, 5, libelle, taille=7.5, couleur=GRIS_TEXTE)
        rendu.valeur_ou_vide(70, y, 132, str(valeur) if valeur else None, gras=True)
        y += 6.4

    y += 4
    rendu.ecrire(8, y, 194, 5, "Motif", taille=8, gras=True, couleur=CERFA_BLEU_TITRE)
    y = rendu.paragraphe(8, y + 6, 194, brouillon.motif_non_applicable or "", taille=8,
                         hauteur=4.4)

    y = rendu.paragraphe(
        8, y + 4, 194,
        "Aucun formulaire n'est reproduit : il n'y a rien à déposer. Ce document constate "
        "l'absence d'obligation sur la période et en donne la raison.",
        taille=6.8, hauteur=3.4, couleur=GRIS_TEXTE,
    )

    rendu.ecrire(8, 236, 194, 5, f"Établi le {_lettres(jour)}", taille=7,
                 couleur=GRIS_TEXTE)
    _bloc_visa(rendu, 242, encre=CERFA_BLEU)
    _pied_reproduction(rendu)


# Un gabarit par déclaration : aucune ne retombe sur une mise en page libre.
TEMPLATES = {
    "ca_urssaf": page_attestation_urssaf,
    "revenus_2042": page_cerfa_2042,
    "cfe": page_cerfa_1447c,
    "des": page_des,
    "tva_ca3": page_ca3,
}


def gabarit_pour(brouillon: Brouillon):
    """Le gabarit qui convient à ce brouillon — jamais `None`.

    Une déclaration sans objet reçoit la page de constat plutôt que l'imprimé qu'elle
    n'aurait pas à déposer.
    """
    if not brouillon.applicable:
        return page_non_applicable
    return TEMPLATES.get(brouillon.type, page_non_applicable)
