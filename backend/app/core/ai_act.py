"""Transparence IA — article 50 du règlement européen sur l'IA.

Tout ce que LedgerMind montre à l'utilisateur est produit par des systèmes d'IA : réponses
de chat, feuilles de route, rapports, brouillons de déclaration, visuels de l'interface.
L'article 50 impose deux marquages **distincts**, qu'on ne peut pas remplacer l'un par
l'autre :

  1. **Visible** (art. 50(1) et 50(4)) — un humain doit comprendre qu'il parle à une IA, ou
     qu'il lit un contenu généré. Posé côté frontend (`components/lm/AiLabel.tsx`) et,
     pour les documents, imprimé dans la page par `filigrane_pdf()` ci-dessous.
  2. **Lisible par machine** (art. 50(2)) — le contenu lui-même doit porter la marque, pour
     que moteurs, plateformes et robots la retrouvent après téléchargement ou repartage.
     C'est ce module qui la pose, par deux moyens selon ce que le format accepte :

     * **métadonnées de document** — pour les PDF. C2PA ne couvre pas ce format (ni le SDK,
       ni la liste du guide, qui s'arrête à JPEG, PNG, MP4, MP3, WebM) : un PDF ne peut
       donc pas porter de manifeste signé, et son marquage passe entièrement par le
       dictionnaire Info écrit par `marquer_pdf()`. Conforme, mais non cryptographique.
     * **signature C2PA** — pour les images, l'audio et la vidéo, quand une chaîne est
       configurée. Elle prouve en plus l'intégrité : toute retouche postérieure est
       détectée. `format_signable()` dit ce que le SDK accepte réellement.

     Les réponses d'API portent en outre des en-têtes de transparence, pour les clients qui
     ne passent pas par notre interface.

Le point de vigilance retenu du guide : un marquage qui ne vit que dans le DOM de la page
disparaît à l'export et ne vaut rien. Tout ce qui sort d'ici est donc écrit *dans le
fichier*, pas autour.

Échéances : l'article 50 est applicable depuis le 2 août 2026 ; le marquage lisible par
machine des systèmes déjà en service avant cette date est exigible au 2 décembre 2026.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from app.core.paths import BACKEND_DIR

# ---------------------------------------------------------------------------------------
# Identité déclarée dans chaque marquage
# ---------------------------------------------------------------------------------------

FOURNISSEUR = "LedgerMind"
OUTIL = "LedgerMind Assistant"

#: Valeurs de l'énumération C2PA `digitalSourceType` (IPTC). Ce sont ces URI, et pas nos
#: libellés français, que les vérificateurs automatiques savent interpréter.
SOURCE_TRAINED_ALGORITHMIC = (
    "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
)
SOURCE_COMPOSITE_WITH_TRAINED = (
    "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"
)
SOURCE_ALGORITHMIC = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia"

Niveau = Literal["genere", "modifie", "assiste"]


@dataclass(frozen=True)
class Marquage:
    """Un niveau d'implication de l'IA, avec ses libellés et son URI machine.

    Trois niveaux, calés sur les trois icônes du jeu publié par la Commission :

    * ``genere``  — contenu entièrement produit par l'IA, sans élément humain préexistant
      ni contrôle éditorial au-delà du prompt. C'est le cas des réponses de chat, des
      feuilles de route et des visuels de l'interface.
    * ``modifie`` — un contenu humain préexistant a été transformé par l'IA. Cas des
      documents construits à partir des pièces fournies par l'utilisateur : facture,
      rapport d'activité, brouillon de déclaration.
    * ``assiste`` — l'IA a contribué, mais une personne identifiée assume la responsabilité
      éditoriale du résultat. L'art. 50(4) lève l'obligation de marquage dans ce cas ;
      on marque quand même, et le nom du responsable accompagne la mention.
    """

    niveau: Niveau
    libelle_court: str
    libelle_long: str
    source_type: str


MARQUAGES: dict[Niveau, Marquage] = {
    "genere": Marquage(
        niveau="genere",
        libelle_court="Généré par IA",
        libelle_long=(
            "Ce contenu a été entièrement généré par une intelligence artificielle. "
            "Il n'a pas été relu par un professionnel avant affichage."
        ),
        source_type=SOURCE_TRAINED_ALGORITHMIC,
    ),
    "modifie": Marquage(
        niveau="modifie",
        libelle_court="Modifié par IA",
        libelle_long=(
            "Ce document a été composé par une intelligence artificielle à partir des "
            "pièces que vous avez fournies. Les montants en sont issus ; vérifiez-les "
            "avant toute déclaration."
        ),
        source_type=SOURCE_COMPOSITE_WITH_TRAINED,
    ),
    "assiste": Marquage(
        niveau="assiste",
        libelle_court="Assisté par IA",
        libelle_long=(
            "Ce contenu a été produit avec l'aide d'une intelligence artificielle, puis "
            "relu sous responsabilité éditoriale humaine."
        ),
        source_type=SOURCE_ALGORITHMIC,
    ),
}

#: Phrase de premier contact des agents conversationnels (art. 50(1)). Elle doit apparaître
#: avant le premier échange, pas dans des CGU : le guide écarte explicitement ce placement.
DIVULGATION_CHAT = (
    "Vous échangez avec une intelligence artificielle, pas avec un conseiller humain. "
    "Ses réponses sont générées automatiquement et ne constituent pas un conseil fiscal."
)

#: Mention imprimée dans les documents exportés. Elle part avec le fichier ; c'est ce qui la
#: distingue d'un bandeau de page, qui disparaît au téléchargement.
MENTION_DOCUMENT = (
    "Document généré par intelligence artificielle (LedgerMind) - "
    "art. 50 du reglement (UE) 2024/1689 sur l'IA. A verifier avant toute declaration."
)


# ---------------------------------------------------------------------------------------
# Marquage lisible par machine — métadonnées de document
# ---------------------------------------------------------------------------------------


def metadonnees_document(niveau: Niveau = "genere") -> dict[str, str]:
    """Champs de métadonnées à écrire dans un document exporté.

    Reprend le vocabulaire que les outils lisent réellement : ``dc:``/``xmp:`` pour les
    lecteurs PDF, ``digitalSourceType`` d'IPTC pour les vérificateurs de provenance.
    """
    marquage = MARQUAGES[niveau]
    return {
        "creator": OUTIL,
        "producer": f"{OUTIL} - contenu genere par IA",
        "keywords": (
            f"AI-generated, {marquage.libelle_court}, EU AI Act Article 50, "
            f"digitalSourceType={marquage.source_type}"
        ),
        "subject": MENTION_DOCUMENT,
        "digital_source_type": marquage.source_type,
        "ai_disclosure": marquage.libelle_long,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def marquer_pdf(pdf, niveau: Niveau = "genere") -> None:
    """Écrit le marquage IA dans les métadonnées d'un document fpdf2.

    À appeler avant `pdf.output()`. Les champs atterrissent dans le dictionnaire Info du
    PDF : ils survivent au téléchargement, au repartage et à la plupart des conversions,
    contrairement à un texte de page qu'une extraction peut perdre.
    """
    meta = metadonnees_document(niveau)
    pdf.set_creator(meta["creator"])
    pdf.set_producer(meta["producer"])
    pdf.set_keywords(meta["keywords"])
    pdf.set_subject(meta["subject"])


def filigrane_pdf(
    pdf,
    texte=lambda s: s,
    *,
    niveau: Niveau = "genere",
    x: float = 16,
    police: Optional[str] = None,
) -> None:
    """Imprime la mention visible à la suite du contenu de la page.

    Dans le flux, et non en surimpression à une ordonnée fixe : le guide demande qu'aucun
    élément ne puisse recouvrir l'étiquette, et une position absolue en bas de page vient
    tôt ou tard se poser sur du contenu quand le document s'allonge. En flux, le saut de
    page automatique de fpdf2 la reporte proprement sur la page suivante.

    `x` doit valoir la marge gauche du module appelant : la largeur « auto » de fpdf2 se
    calcule depuis la position X courante. `texte` est sa fonction d'échappement (les
    gabarits replient les caractères non latin-1 quand la police unicode manque).
    """
    marquage = MARQUAGES[niveau]
    pdf.ln(3)
    pdf.set_x(x)
    pdf.set_font(police or getattr(pdf, "police", "Helvetica"), "B", 7.5)
    pdf.set_text_color(68, 64, 60)
    pdf.multi_cell(
        0,
        3.6,
        texte(f"[IA] {marquage.libelle_court} - {MENTION_DOCUMENT}"),
        align="L",
    )
    pdf.set_text_color(0, 0, 0)


# ---------------------------------------------------------------------------------------
# Marquage lisible par machine — réponses d'API
# ---------------------------------------------------------------------------------------


#: Libellés ASCII des niveaux, réservés aux en-têtes HTTP.
#:
#: Un en-tête HTTP se sérialise en latin-1 : « Généré par IA » lève un UnicodeDecodeError
#: au moment de l'envoi et fait échouer la réponse ENTIÈRE, pas seulement l'en-tête. Les
#: libellés accentués restent pour l'affichage et les documents ; ici, de l'ASCII, et en
#: anglais parce que c'est un canal lu par des machines et des intégrateurs.
_LIBELLES_ENTETE: dict[Niveau, str] = {
    "genere": "AI-generated",
    "modifie": "AI-modified",
    "assiste": "AI-assisted",
}


def entetes_http(niveau: Niveau = "genere") -> dict[str, str]:
    """En-têtes de transparence à poser sur toute réponse contenant du texte généré.

    Un client qui consomme l'API sans passer par notre interface (intégration, robot,
    agrégateur) n'a que ça pour savoir que la charge utile est synthétique.

    Valeurs strictement ASCII : voir `_LIBELLES_ENTETE`.
    """
    return {
        "X-AI-Generated": "true",
        "X-AI-Disclosure": _LIBELLES_ENTETE[niveau],
        "X-AI-Provider": FOURNISSEUR,
        "X-Digital-Source-Type": MARQUAGES[niveau].source_type,
    }


# ---------------------------------------------------------------------------------------
# Signature C2PA
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ConfigSignature:
    cle: Path
    chaine: Path
    algorithme: str


@lru_cache(maxsize=1)
def config_signature() -> Optional[ConfigSignature]:
    """Chemins de signature, ou None si aucune clé n'est configurée.

    L'absence de clé n'est pas une erreur : le marquage visible et les métadonnées de
    document restent posés. Seule la preuve cryptographique de provenance manque.
    Voir `backend/certs/README.md` pour générer la chaîne.
    """
    from app.config import settings  # noqa: PLC0415 — évite un cycle core ↔ config

    cle = settings.c2pa_signer_key
    chaine = settings.c2pa_signer_chain
    if not cle or not chaine:
        return None

    chemin_cle = Path(cle)
    chemin_chaine = Path(chaine)
    if not chemin_cle.is_absolute():
        chemin_cle = (BACKEND_DIR.parent / chemin_cle).resolve()
    if not chemin_chaine.is_absolute():
        chemin_chaine = (BACKEND_DIR.parent / chemin_chaine).resolve()

    if not chemin_cle.exists() or not chemin_chaine.exists():
        return None

    return ConfigSignature(
        cle=chemin_cle,
        chaine=chemin_chaine,
        algorithme=settings.c2pa_signer_alg or "es256",
    )


def manifeste_c2pa(niveau: Niveau = "genere", titre: str = "") -> dict:
    """Manifeste C2PA décrivant comment l'actif a été produit.

    L'assertion qui porte l'obligation légale est ``c2pa.actions`` avec l'action
    ``c2pa.created`` et le ``digitalSourceType`` correspondant : c'est elle que les
    vérificateurs traduisent en badge « contenu généré par IA ».
    """
    marquage = MARQUAGES[niveau]
    return {
        "claim_generator": f"{OUTIL}/1.0",
        "title": titre or "Contenu LedgerMind",
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "softwareAgent": OUTIL,
                            "digitalSourceType": marquage.source_type,
                        }
                    ]
                },
            },
            {
                "label": "stds.schema-org.CreativeWork",
                "data": {
                    "@context": "https://schema.org",
                    "@type": "CreativeWork",
                    "creditText": f"Généré par IA — {FOURNISSEUR}",
                    "publisher": {"@type": "Organization", "name": FOURNISSEUR},
                },
            },
            {
                "label": "com.ledgermind.eu-ai-act",
                "data": {
                    "regulation": "Regulation (EU) 2024/1689 — Article 50",
                    "disclosure": marquage.libelle_long,
                    "level": marquage.niveau,
                    "signed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                },
            },
        ],
    }


def format_signable(format_mime: str) -> bool:
    """Le format accepte-t-il l'incrustation d'un manifeste C2PA ?

    **Le PDF n'en fait pas partie** — ni dans le SDK, ni dans la liste du guide, qui ne cite
    que JPEG, PNG, MP4, MP3 et WebM. Un PDF ne peut donc pas porter de signature C2PA
    incrustée, et son marquage lisible par machine passe entièrement par les métadonnées de
    document écrites par `marquer_pdf()`. C'est une limite du format, pas un choix : le
    marquage reste conforme, il est simplement non cryptographique.

    Interroger le SDK plutôt que coder une liste en dur : elle s'allonge d'une version à
    l'autre, et une liste figée refuserait des formats devenus signables.
    """
    try:
        from c2pa import Builder  # noqa: PLC0415

        return format_mime in Builder.get_supported_mime_types()
    except ImportError:
        return False


def signer(donnees: bytes, format_mime: str, niveau: Niveau = "genere",
           titre: str = "") -> bytes:
    """Incruste un manifeste C2PA signé dans l'actif, ou le renvoie inchangé.

    Renvoyer l'original plutôt que lever est délibéré : la signature est une couche de
    preuve *en plus* du marquage déjà présent dans le fichier. Ni un format qui ne la
    supporte pas, ni un poste sans clé, ni l'absence du SDK ne doivent empêcher un
    utilisateur de télécharger sa facture. Ce qui manque est journalisé, pas silencieux.
    """
    config = config_signature()
    if config is None:
        return donnees

    import logging  # noqa: PLC0415

    journal = logging.getLogger(__name__)

    try:
        from c2pa import Builder, C2paSignerInfo, C2paSigningAlg, Signer  # noqa: PLC0415
    except ImportError:
        journal.info(
            "c2pa-python absent : contenu marqué (métadonnées) mais non signé. "
            "pip install c2pa-python pour activer la signature."
        )
        return donnees

    if format_mime not in Builder.get_supported_mime_types():
        journal.debug(
            "%s n'accepte pas de manifeste C2PA incrusté ; marquage par métadonnées seul.",
            format_mime,
        )
        return donnees

    try:
        info = C2paSignerInfo(
            alg=config.algorithme.lower().encode("utf-8"),
            sign_cert=config.chaine.read_bytes(),
            private_key=config.cle.read_bytes(),
            # Pas d'horodatage RFC 3161 : il exige un service externe, et son indisponibilité
            # ferait échouer une signature qui reste valable sans lui. À renseigner le jour
            # où la provenance doit survivre à l'expiration du certificat.
            ta_url=None,
        )
        with Signer.from_info(info) as signataire:
            with Builder(manifeste_c2pa(niveau, titre)) as constructeur:
                entree = io.BytesIO(donnees)
                sortie = io.BytesIO()
                constructeur.sign(signataire, format_mime, entree, sortie)
                return sortie.getvalue()
    except Exception as exc:  # noqa: BLE001 — jamais bloquant pour un téléchargement
        journal.warning("Signature C2PA impossible : %s", exc)
        return donnees


def etat_transparence() -> dict:
    """État du dispositif, pour la page de transparence et la piste d'audit.

    Le guide demande de documenter où et comment la divulgation est présentée ; cet objet
    est la source unique de cette documentation, exposée par `GET /ai-act/transparence`.
    """
    config = config_signature()
    return {
        "fournisseur": FOURNISSEUR,
        "outil": OUTIL,
        "reglement": "Règlement (UE) 2024/1689 — article 50",
        "applicable_depuis": "2026-08-02",
        "echeance_marquage_machine": "2026-12-02",
        "niveaux": {
            cle: {
                "libelle_court": m.libelle_court,
                "libelle_long": m.libelle_long,
                "digital_source_type": m.source_type,
            }
            for cle, m in MARQUAGES.items()
        },
        "divulgation_chat": DIVULGATION_CHAT,
        "mention_document": MENTION_DOCUMENT,
        "marquage_visible": True,
        "marquage_metadonnees": True,
        "signature_c2pa": config is not None,
        "algorithme_signature": config.algorithme if config else None,
    }
