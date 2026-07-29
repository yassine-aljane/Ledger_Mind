"""Answer understanding for branch B — Gemini JSON + deterministic regex fallback."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

from app.llm.gemini import chat_json
from app.schemas.orchestrator import DiagnosticProfile

logger = logging.getLogger(__name__)

UnderstandStatus = Literal["ok", "confused", "off_topic", "unclear"]

_ACTIVITES = [
    ("youtube", "YouTube"),
    ("instagram", "Instagram"),
    ("tiktok", "TikTok"),
    ("twitch", "Twitch"),
    ("linkedin", "LinkedIn"),
    ("podcast", "podcast"),
    ("influenc", "influence"),
    ("streamer", "streaming"),
    ("stream", "streaming"),
    ("graphiste", "graphisme"),
    ("photograph", "photographie"),
    ("vidéo", "création de contenu vidéo"),
    ("video", "création de contenu vidéo"),
    ("rédac", "rédaction"),
    ("redac", "rédaction"),
    ("développ", "développement"),
    ("developp", "développement"),
    ("consultant", "conseil"),
    ("coach", "coaching"),
    ("freelance", "freelance"),
    ("blog", "blog"),
    ("créat", "création de contenu"),
    ("creat", "création de contenu"),
]

_PERIODES = {"mois": 12, "semaine": 52, "jour": 365, "an": 1, "année": 1, "annee": 1}
_NUM = r"(\d[\d\s\u00a0]*\d|\d)"
_MULT_PERIODE = {"an": 1, "annee": 1, "année": 1, "mois": 12, "semaine": 52, "jour": 365}


def _montant(txt: str) -> float:
    return float(txt.replace(" ", "").replace("\u00a0", ""))


def _ca_annuel(m: str) -> float | None:
    mm = re.search(
        _NUM + r"\s*(k)?\s*(?:€|euros?)?\s*(?:/|par\s+)\s*(mois|an|année|annee|semaine|jour)",
        m,
    )
    if mm:
        val = _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
        return val * _PERIODES[mm.group(3)]
    mm = re.search(r"(?:ca|chiffre d['’ ]affaires)\D{0,6}" + _NUM + r"\s*(k)?", m)
    if mm:
        return _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
    # bare amount with euro
    mm = re.search(_NUM + r"\s*(k)?\s*(?:€|euros?)", m)
    if mm:
        return _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
    # bare number (e.g. "25000" typed freely)
    mm = re.fullmatch(r"\s*" + _NUM + r"\s*(k)?\s*", m)
    if mm:
        return _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
    # range quick-replies
    if "moins de 10" in m:
        return 5_000.0
    if "10 000" in m or "10000" in m:
        return 20_000.0
    if "30 000" in m or "30000" in m:
        return 50_000.0
    if "77 700" in m or "77700" in m or "plus de 77" in m:
        return 90_000.0
    return None


def extraire_profil_regex(message: str) -> dict[str, Any]:
    """Deterministic fallback extraction (ported from agent_NoSiren)."""
    m = message.lower()
    out: dict[str, Any] = {}
    for cle, libelle in _ACTIVITES:
        if cle in m:
            out["activite"] = libelle
            break
    ca = _ca_annuel(m)
    if ca is not None:
        out["ca_estime_annuel"] = ca
    if (
        re.search(r"\b(non|pas de|aucun|aucune|sans)\b[^.?!]*(?:produit|merch|vente|marchandise)", m)
        or "pas de vente" in m
        or "que des prestations" in m
        or "uniquement des prestations" in m
    ):
        out["vend_produits"] = False
    elif any(
        w in m
        for w in (
            "merch",
            "boutique",
            "je vends",
            "vends des",
            "vends du",
            "vente de",
            "revends",
            "e-commerce",
            "dropshipping",
        )
    ):
        out["vend_produits"] = True
    if any(w in m for w in ("cadeau", "produit gratuit", "produits gratuits", "dotation", "gifting")):
        out["recoit_cadeaux"] = True
    if "salari" in m:
        out["situation_actuelle"] = "salarié"
    elif "étudiant" in m or "etudiant" in m:
        out["situation_actuelle"] = "étudiant"
    elif "demandeur d'emploi" in m or "chômage" in m or "chomage" in m:
        out["situation_actuelle"] = "demandeur d'emploi"
    elif "indépendant" in m or "independant" in m:
        out["situation_actuelle"] = "indépendant"
    if any(w in m for w in ("je débute", "je debute", "première année", "premiere annee", "viens de me lancer")):
        out["premiere_annee"] = True
        out["ca_n_1_au_dessus_seuil"] = False
        out["anciennete"] = "Je débute cette année"
    return out


def _annualiser(montant: Any, periode: str | None) -> float | None:
    if not isinstance(montant, (int, float)):
        return None
    return float(montant) * _MULT_PERIODE.get((periode or "an"), 1)


def _apply_updates(profile: DiagnosticProfile, updates: dict[str, Any]) -> DiagnosticProfile:
    data = profile.model_dump()
    for key, value in updates.items():
        if key not in data or value is None:
            continue
        data[key] = value
    return DiagnosticProfile(**data)


_INSTRUCTION = """Tu analyses la réponse d'un créateur / freelance français pour un diagnostic fiscal LedgerMind (pas encore immatriculé).

Profil diagnostic actuel (JSON) :
{current_profile}

Champ attendu : {target_field}
Description : {field_description}

Question posée :
{last_question}

Réponse de l'utilisateur :
{last_answer}

Décide le statut :
- "ok" : la réponse répond à la question → remplis "updates"
- "confused" : demande reformulation → updates = {{}}
- "off_topic" : hors sujet → updates = {{}}
- "unclear" : trop vague → updates = {{}}

IMPORTANT : options claires (Oui/Non, montants, activités) → status DOIT être "ok".

Types updates (seulement champs explicitement exprimés) :
- activite : string
- ca_estime_annuel : number (annualisé en euros)
- vend_produits / recoit_cadeaux / premiere_annee / ca_n_1_au_dessus_seuil / ca_n_2_au_dessus_seuil : booléen
- type_activite : "prestation" | "vente" | "mixte"
- situation_actuelle / anciennete : string
- ca_prestations / ca_vente : number (si ventilation)
- jours_activite : int
- choix_parcours : "micro" | "societe"

Règles :
- Cadeaux / dotations → recoit_cadeaux=true, jamais une vente.
- "Je ne vends pas" → vend_produits=false.
- "Je débute / pas d'activité l'an dernier" → premiere_annee=true, ca_n_1_au_dessus_seuil=false.
- Pour ventilation : estime ca_prestations et ca_vente cohérents avec le CA total si possible.
- Montants : "3000 € / mois" → ca_estime_annuel=36000.

Réponds UNIQUEMENT avec un objet JSON :
{{"status":"ok","assistant_message":null,"updates":{{"activite":"YouTube"}}}}
"""

_FIELD_HINTS = {
    "activite": "activité principale",
    "ca_estime_annuel": "chiffre d'affaires annuel estimé en euros",
    "vend_produits": "vend des produits / merch (oui/non)",
    "ventilation": "répartition CA prestations vs ventes",
    "recoit_cadeaux": "reçoit cadeaux / dotations (oui/non)",
    "situation_actuelle": "situation (salarié, étudiant…)",
    "anciennete": "depuis quand l'activité génère des revenus",
    "ca_n_1_au_dessus_seuil": "CA N-1 au-dessus du plafond micro (oui/non)",
}

# Only these keys may be written for a given target question (prevents LLM over-fill).
_ALLOWED_UPDATES: dict[str, set[str]] = {
    "activite": {"activite", "type_activite"},
    "ca_estime_annuel": {"ca_estime_annuel"},
    "vend_produits": {"vend_produits", "type_activite"},
    "ventilation": {"ca_prestations", "ca_vente", "type_activite"},
    "recoit_cadeaux": {"recoit_cadeaux"},
    "situation_actuelle": {"situation_actuelle"},
    "anciennete": {"anciennete", "premiere_annee", "jours_activite"},
    "ca_n_1_au_dessus_seuil": {
        "ca_n_1_au_dessus_seuil",
        "ca_n_2_au_dessus_seuil",
        "premiere_annee",
    },
}

_ACTIVITE_QUICK = {
    "création de contenu": ("Création de contenu", "prestation"),
    "creation de contenu": ("Création de contenu", "prestation"),
    "prestation freelance": ("Prestation freelance", "prestation"),
    "vente de produits": ("Vente de produits", "vente"),
    "mixte": ("Mixte", "mixte"),
}


def _scope_updates(target_field: str | None, updates: dict[str, Any]) -> dict[str, Any]:
    if not target_field:
        return {}
    allowed = _ALLOWED_UPDATES.get(target_field)
    if not allowed:
        return {k: v for k, v in updates.items() if k == target_field and v is not None}
    return {k: v for k, v in updates.items() if k in allowed and v is not None}


def _quick_reply_updates(target_field: str | None, answer: str) -> dict[str, Any] | None:
    """Map known quick replies without calling the LLM."""
    if not target_field:
        return None
    low = answer.lower().strip()
    if target_field == "activite":
        hit = _ACTIVITE_QUICK.get(low)
        if hit:
            return {"activite": hit[0], "type_activite": hit[1]}
        if low:
            return {"activite": answer.strip()}
    if target_field == "situation_actuelle" and low:
        return {"situation_actuelle": answer.strip()}
    if target_field == "anciennete" and low:
        out: dict[str, Any] = {"anciennete": answer.strip()}
        if "débute" in low or "debute" in low:
            out["premiere_annee"] = True
            out["ca_n_1_au_dessus_seuil"] = False
        return out
    return None


@dataclass
class UnderstandResult:
    status: UnderstandStatus
    profile: DiagnosticProfile
    assistant_message: str | None = None


async def understand_answer(
    profile: DiagnosticProfile,
    last_question: str,
    last_answer: str,
    *,
    target_field: str | None,
) -> UnderstandResult:
    # Fast path: known quick replies — no LLM, no cross-field invention
    quick = _quick_reply_updates(target_field, last_answer)
    if quick is not None and target_field in (
        "activite",
        "situation_actuelle",
        "anciennete",
    ):
        return UnderstandResult(status="ok", profile=_apply_updates(profile, quick))

    regex_updates = _scope_updates(target_field, extraire_profil_regex(last_answer))

    if target_field == "vend_produits" and "vend_produits" not in regex_updates:
        low = last_answer.lower().strip()
        if low.startswith("oui"):
            regex_updates["vend_produits"] = True
        elif low.startswith("non"):
            regex_updates["vend_produits"] = False
    if target_field == "recoit_cadeaux" and "recoit_cadeaux" not in regex_updates:
        low = last_answer.lower().strip()
        if low.startswith("oui"):
            regex_updates["recoit_cadeaux"] = True
        elif low.startswith("non"):
            regex_updates["recoit_cadeaux"] = False
    if target_field == "ca_n_1_au_dessus_seuil" and "ca_n_1_au_dessus_seuil" not in regex_updates:
        low = last_answer.lower().strip()
        if low.startswith("oui"):
            regex_updates["ca_n_1_au_dessus_seuil"] = True
        elif low.startswith("non") or "débute" in low or "debute" in low or "pas d'activité" in low:
            regex_updates["ca_n_1_au_dessus_seuil"] = False
            regex_updates["premiere_annee"] = True
    if target_field == "ca_estime_annuel" and "ca_estime_annuel" not in regex_updates:
        ca = _ca_annuel(last_answer.lower())
        if ca is not None:
            regex_updates["ca_estime_annuel"] = ca
    if target_field == "ventilation" and profile.ca_estime_annuel is not None:
        low = last_answer.lower()
        ca = float(profile.ca_estime_annuel)
        if "moitié" in low or "moitie" in low:
            regex_updates.update(
                {"ca_prestations": ca / 2, "ca_vente": ca / 2, "type_activite": "mixte"}
            )
        elif "surtout prestations" in low:
            regex_updates.update(
                {"ca_prestations": ca * 0.8, "ca_vente": ca * 0.2, "type_activite": "mixte"}
            )
        elif "surtout ventes" in low:
            regex_updates.update(
                {"ca_prestations": ca * 0.2, "ca_vente": ca * 0.8, "type_activite": "mixte"}
            )

    # If deterministic path already satisfied the target, skip LLM
    if _target_satisfied(target_field, regex_updates):
        return UnderstandResult(
            status="ok",
            profile=_apply_updates(profile, regex_updates),
        )

    prompt = _INSTRUCTION.format(
        current_profile=profile.model_dump_json(),
        target_field=target_field or "unknown",
        field_description=_FIELD_HINTS.get(target_field or "", target_field or ""),
        last_question=last_question,
        last_answer=last_answer,
    )

    try:
        data = await chat_json(prompt, temperature=0.0, max_tokens=512)
        status = data.get("status", "unclear")
        if status not in ("ok", "confused", "off_topic", "unclear"):
            status = "unclear"
        updates = data.get("updates") or {}
        if not isinstance(updates, dict):
            updates = {}

        if "ca_estime" in updates and "ca_estime_annuel" not in updates:
            updates["ca_estime_annuel"] = updates.pop("ca_estime")
        periode = updates.pop("periode", None)
        if "ca_estime_annuel" in updates and periode:
            ann = _annualiser(updates["ca_estime_annuel"], periode)
            if ann is not None:
                updates["ca_estime_annuel"] = ann

        updates = _scope_updates(target_field, updates)
        merged = {**regex_updates, **updates} if status == "ok" else dict(regex_updates)

        if _target_satisfied(target_field, merged):
            status = "ok"
            new_profile = _apply_updates(profile, merged)
            if target_field == "vend_produits" and new_profile.vend_produits is None:
                new_profile = _apply_updates(new_profile, {"vend_produits": False})
            if target_field == "recoit_cadeaux" and new_profile.recoit_cadeaux is None:
                new_profile = _apply_updates(new_profile, {"recoit_cadeaux": False})
            return UnderstandResult(status="ok", profile=new_profile)

        msg = data.get("assistant_message")
        return UnderstandResult(
            status=status,  # type: ignore[arg-type]
            profile=profile,
            assistant_message=msg if isinstance(msg, str) else None,
        )
    except Exception as e:
        logger.warning("Guidance understand LLM failed: %s — regex fallback", e)
        if _target_satisfied(target_field, regex_updates):
            return UnderstandResult(
                status="ok",
                profile=_apply_updates(profile, regex_updates),
            )
        return UnderstandResult(
            status="unclear",
            profile=profile,
            assistant_message="Peux-tu préciser un peu ?",
        )


def _target_satisfied(target_field: str | None, updates: dict) -> bool:
    if not target_field:
        return bool(updates)
    if target_field == "ventilation":
        return "ca_prestations" in updates or "ca_vente" in updates
    return target_field in updates
