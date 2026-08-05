"""Estimation de la valeur marchande d'un cadeau en nature, depuis une photo.

Pourquoi un module à part, hors du graphe LangGraph : le parcours d'un cadeau n'est
pas celui d'un justificatif. Une facture est un document qu'on LIT (OCR → extraction
→ classification → contrôles), avec une vérité imprimée dessus. Un cadeau est un
OBJET qu'on reconnaît sur une photo, sans aucune vérité imprimée : le modèle propose,
l'utilisateur tranche, et c'est sa décision qui est déclarée. Il n'y a donc ni
déduplication par numéro de pièce, ni boucle de confirmation champ par champ — juste
une suggestion, affichée comme telle.

Cadre fiscal (rappelé dans les messages rendus à l'utilisateur) : un partenariat
rémunéré en produits est un revenu en nature, déclarable à la valeur marchande de
l'objet (prix public TTC, état neuf), et porté au livre des recettes comme un
encaissement.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from .config import MODEL_LARGE, MODEL_VISION
from .mistral_client import MistralClient, MistralError
from .schemas import EstimationCadeau

logger = logging.getLogger(__name__)

# Niveaux de confiance admis. Toute autre valeur du modèle est ramenée à « faible » :
# une confiance inventée serait plus trompeuse qu'une confiance basse.
CONFIANCES = ("haute", "moyenne", "faible")

AVERTISSEMENT = (
    "Suggestion automatique depuis la photo — à vérifier et corriger avant de déclarer "
    "le cadeau. La valeur marchande retenue doit correspondre au prix public TTC réel de "
    "l'objet (état neuf), sous votre responsabilité : LedgerMind ne peut pas garantir un "
    "prix exact depuis une image."
)

SYSTEM_VISION = """Tu es un expert en évaluation d'objets pour la déclaration fiscale française.

On te montre la photo d'un cadeau reçu par un créateur de contenu de la part d'une marque
(« gifting »). Ta tâche : identifier l'objet et estimer sa VALEUR MARCHANDE, c'est-à-dire
le prix public TTC auquel il se vend NEUF en France.

Règles absolues :
- Tu n'inventes JAMAIS une marque ou un modèle que tu ne vois pas. Si le logo n'est pas
  lisible, `marque` vaut null.
- Si tu ne reconnais pas l'objet avec assez de certitude pour avancer un prix, mets
  `valeur_estimee` à null et `confiance` à "faible". Une fourchette large reste utile.
- `confiance` vaut :
    "haute"   : objet ET marque identifiés, prix public connu et stable.
    "moyenne" : catégorie d'objet claire, mais marque/modèle incertains.
    "faible"  : objet ambigu, photo insuffisante, ou prix très variable.
- Les montants sont en EUROS, TTC, nombres simples (pas de symbole, pas d'espace).
- `description` est courte et factuelle (ce qu'on voit), en français.

Réponds UNIQUEMENT par un objet JSON :
{
  "objet_identifie": string|null,
  "description": string|null,
  "marque": string|null,
  "valeur_estimee": number|null,
  "fourchette_min": number|null,
  "fourchette_max": number|null,
  "confiance": "haute"|"moyenne"|"faible",
  "raison": string|null
}"""

USER_VISION = (
    "Identifie cet objet et estime sa valeur marchande TTC en euros, prix public neuf en "
    "France. Si tu n'es pas sûr, dis-le par une confiance basse et une fourchette large "
    "plutôt que par un chiffre précis."
)


def _nombre(valeur: Any) -> Optional[float]:
    """Convertit une valeur du modèle en float positif, ou None.

    Le modèle renvoie parfois « 120 € », « 120-150 » ou une chaîne vide malgré la
    consigne : on préfère perdre la valeur que déclarer un montant fantaisiste.
    """
    if valeur is None or isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float)):
        n = float(valeur)
        return n if n > 0 else None
    if isinstance(valeur, str):
        nettoye = valeur.replace("€", "").replace(",", ".").replace(" ", "").strip()
        # « 120-150 » : on ne devine pas laquelle des deux bornes est voulue.
        if not nettoye or any(c not in "0123456789." for c in nettoye):
            return None
        try:
            n = float(nettoye)
        except ValueError:
            return None
        return n if n > 0 else None
    return None


def _texte(valeur: Any) -> Optional[str]:
    if not isinstance(valeur, str):
        return None
    propre = valeur.strip()
    return propre or None


def _message(
    objet: Optional[str],
    valeur: Optional[float],
    bas: Optional[float],
    haut: Optional[float],
    confiance: str,
) -> str:
    """Phrase affichée en tête du formulaire, adaptée à ce qui a réellement été trouvé."""
    if valeur is None and bas is None and haut is None:
        return (
            "Objet non identifié avec assez de certitude pour proposer une valeur — "
            "complétez manuellement ci-dessous."
        )
    nom = objet or "Objet"
    if valeur is not None:
        base = f"{nom} — valeur estimée à {valeur:.0f} €"
    else:
        base = f"{nom} — pas de valeur unique proposée"
    if bas is not None and haut is not None:
        base += f" (fourchette {bas:.0f}–{haut:.0f} €)"
    if confiance != "haute":
        base += ". Vérifiez ce montant avant de déclarer."
    return base


def estimer_cadeau(client: MistralClient, image: bytes, mime: str) -> EstimationCadeau:
    """Analyse la photo d'un cadeau et renvoie une suggestion de valeur.

    Ne lève jamais sur un échec du modèle : une estimation indisponible doit laisser
    l'utilisateur saisir sa valeur à la main, pas bloquer la déclaration d'un revenu
    qu'il a l'obligation de déclarer.
    """
    brut: Dict[str, Any] = {}
    try:
        brut = client.chat_vision_json(
            MODEL_VISION,
            SYSTEM_VISION,
            USER_VISION,
            image,
            mime,
            fallback_model=MODEL_LARGE,
        )
    except MistralError as exc:
        logger.warning("Estimation cadeau indisponible : %s", exc)
        return EstimationCadeau(
            confiance="faible",
            message=(
                "L'estimation automatique n'a pas abouti — renseignez la valeur du cadeau "
                "à la main ci-dessous."
            ),
            avertissement=AVERTISSEMENT,
        )

    confiance = _texte(brut.get("confiance")) or "faible"
    if confiance not in CONFIANCES:
        confiance = "faible"

    valeur = _nombre(brut.get("valeur_estimee"))
    bas = _nombre(brut.get("fourchette_min"))
    haut = _nombre(brut.get("fourchette_max"))
    # Une fourchette inversée est un signe que le modèle a mal répondu : on la remet
    # à l'endroit plutôt que d'afficher « 150–50 € ».
    if bas is not None and haut is not None and bas > haut:
        bas, haut = haut, bas
    objet = _texte(brut.get("objet_identifie"))

    return EstimationCadeau(
        objet_identifie=objet,
        description=_texte(brut.get("description")),
        marque=_texte(brut.get("marque")),
        valeur_estimee=valeur,
        fourchette_min=bas,
        fourchette_max=haut,
        confiance=confiance,
        message=_message(objet, valeur, bas, haut, confiance),
        avertissement=AVERTISSEMENT,
    )
