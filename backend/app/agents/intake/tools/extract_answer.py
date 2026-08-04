"""
Tool: normalize / merge profile field updates. No LLM.

Used after LLM understanding (or as deterministic fallback when LLM is down).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

_PROFILE_QUESTION_FIELDS = {
    "activity_types",
    "main_activity_commercial",
    "has_secondary_activity",
    "secondary_activity_types",
    "revenue_sources",
    "currencies",
    "estimated_monthly_revenue",
    "estimated_annual_revenue",
    "revenue_variability",
    "invoices_already_issued",
    "first_income_date",
    "has_recurring_contracts",
    "in_kind_gifts",
    "international_clients",
    # Identité légale et catégorie fiscale précise
    "fiscal_category",
    "bnc_caisse",
    "siret",
    "company_address",
    "activity_start_date",
    "location_zone",
    # Régime de TVA
    "regime_tva",
    "numero_tva_intracommunautaire",
    # Foyer fiscal, exigé par le moteur d'impôt
    "versement_liberatoire",
    "rfr_n_minus_2",
    "family_status",
    "fiscal_parts",
    "other_household_income",
    "acre_active",
    "acre_start_date",
    # Facturation
    "invoicing_iban",
    "professional_liability_insurance",
    "rcs_rm_number",
    "default_payment_terms",
    "default_client_type",
    # Rapprochement des encaissements
    "accepted_payment_methods",
    "manual_income_declaration_mode",
    "cumulative_revenue_current_year",
    "prior_threshold_breach_history",
}

LIST_FIELDS = {
    "activity_types",
    "revenue_sources",
    "currencies",
    "secondary_activity_types",
    "accepted_payment_methods",
}
BOOL_FIELDS = {
    "invoices_already_issued",
    "has_recurring_contracts",
    "in_kind_gifts",
    "international_clients",
    "has_secondary_activity",
    "main_activity_commercial",
    "versement_liberatoire",
    "acre_active",
    "professional_liability_insurance",
    "prior_threshold_breach_history",
}

# Montants : seul un nombre explicite est retenu. Une fourchette (« Moins de 20 000 € ») ne
# devient JAMAIS une valeur ponctuelle — le moteur préfère refuser de calculer l'IR plutôt que
# de s'appuyer sur un chiffre que l'utilisateur n'a pas donné.
NUMBER_FIELDS = {
    "rfr_n_minus_2",
    "fiscal_parts",
    "other_household_income",
    "cumulative_revenue_current_year",
}

# Réponses à choix fermé. Les libellés présentés à l'utilisateur sont en français ; la valeur
# stockée est celle qu'attendent le moteur d'impôt et la logique conditionnelle du questionnaire.
_ENUM_FIELDS: dict[str, list[tuple[tuple[str, ...], str]]] = {
    "fiscal_category": [
        (("vente", "marchandise", "bic_vente"), "BIC_VENTE"),
        (("libéral", "liberal", "bnc"), "BNC"),
        (("prestation", "service", "commercial", "bic_service"), "BIC_SERVICE"),
    ],
    "bnc_caisse": [
        (("cipav",), "CIPAV"),
        (("général", "general", "ssi", "regime_general", "régime général"), "REGIME_GENERAL"),
    ],
    "location_zone": [
        (("dom", "guadeloupe", "martinique", "guyane", "réunion", "reunion", "mayotte",
          "outre-mer", "outre mer"), "dom"),
        (("métropole", "metropole", "france continentale"), "metropole"),
    ],
    "regime_tva": [
        (("réel normal", "reel normal", "reel_normal"), "reel_normal"),
        (("réel simplifié", "reel simplifie", "reel_simplifie", "simplifié"), "reel_simplifie"),
        # « Non, je facture de la TVA » : assujetti sans que le régime précis soit connu.
        (("franchise", "pas de tva", "ne facture pas"), "franchise"),
    ],
    "family_status": [
        (("pacs",), "pacse"),
        (("marié", "marie", "mariée"), "marie"),
        (("célibataire", "celibataire", "seul"), "celibataire"),
    ],
    "default_client_type": [
        (("les deux", "deux", "both", "mixte"), "les_deux"),
        (("professionnel", "entreprise", "b2b"), "professionnels"),
        (("particulier", "b2c"), "particuliers"),
    ],
}

# « Je ne sais pas » n'est PAS une absence de réponse : la question a été posée. La consigner
# évite de la reposer indéfiniment, sans pour autant inventer une valeur.
_UNKNOWN_RE = re.compile(
    r"(je\s+ne\s+sais\s+pas|j['’]?e?\s*sais\s+pas|aucune\s+id[ée]e|sais\s+pas|"
    r"pas\s+s[ûu]r|je\s+ne\s+sais)",
    re.IGNORECASE,
)

_CONFUSION_RE = re.compile(
    r"("
    r"pas\s+compris|compris\s+pas|comprends?\s+pas|pas\s+comprends?|"
    r"j['’]?ai\s+pas\s+compris|jai\s+pas\s+compris|"
    r"je\s+ne\s+comprends?\s+pas|"
    r"r[eé]p[eè]te|redis|reformule|clarifie|"
    r"c['’]?est\s+quoi|cest\s+quoi|\?\?\?|hein\b"
    r")",
    re.IGNORECASE,
)


def is_confused_answer(answer: str) -> bool:
    text = answer.strip()
    if not text:
        return True
    if text in ("?", "??", "???"):
        return True
    return bool(_CONFUSION_RE.search(text))


def _coerce_value(field: str, value: Any, current_profile: UserProfile) -> Any:
    if value is None:
        return None

    if field in LIST_FIELDS:
        existing = list(getattr(current_profile, field) or [])
        if isinstance(value, str):
            new_items = [v.strip() for v in value.split(",") if v.strip()]
        elif isinstance(value, list):
            new_items = [str(v).strip() for v in value if str(v).strip()]
        else:
            new_items = []
        combined = existing + [item for item in new_items if item not in existing]
        return combined or None

    if field in BOOL_FIELDS:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            val_lower = value.strip().lower()
            if val_lower in ("true", "oui", "yes", "1", "vrai"):
                return True
            if val_lower in ("false", "non", "no", "0", "faux"):
                return False
        return None

    if field == "revenue_variability":
        val_str = str(value).strip().lower()
        if "stable" in val_str:
            return "stable"
        if any(k in val_str for k in ("spiky", "irregular", "irrégulier", "pic", "variable")):
            return "spiky"
        if "unknown" in val_str:
            return "unknown"
        return None

    if field in _ENUM_FIELDS:
        val_lower = str(value).strip().lower()
        for motifs, valeur_stockee in _ENUM_FIELDS[field]:
            if any(m in val_lower for m in motifs):
                return valeur_stockee
        return None

    if field in NUMBER_FIELDS:
        return _nombre(value)

    return str(value).strip() or None


def _nombre(valeur: Any) -> float | None:
    """Extrait un nombre d'une réponse en français, ou rien.

    « 1,5 » → 1.5 ; « 20 000 € » → 20000.0 ; « Aucun autre revenu » → 0.0.
    Une FOURCHETTE (« Moins de 20 000 € », « 20 000 € – 50 000 € ») renvoie `None` : la
    convertir en valeur ponctuelle reviendrait à inventer un chiffre que l'utilisateur n'a
    pas donné, et le calcul d'impôt qui en découlerait serait faux sans le dire.
    """
    if isinstance(valeur, (int, float)) and not isinstance(valeur, bool):
        return float(valeur)

    texte = str(valeur).strip().lower()
    if not texte or _UNKNOWN_RE.search(texte):
        return None  # « aucune idée » contient « aucun » : ce n'est pas zéro
    if any(m in texte for m in ("aucun", "rien", "zéro", "zero", "pas de revenu")):
        return 0.0
    if any(m in texte for m in ("moins de", "plus de", "entre", "–", "—", " à ", "environ", "ou plus")):
        return None  # fourchette : non convertible en valeur ponctuelle

    # Espaces (y compris insécables) et virgule décimale à la française.
    normalise = (
        texte.replace(" ", "").replace(" ", "").replace(" ", "").replace(",", ".")
    )
    trouves = re.findall(r"-?\d+(?:\.\d+)?", normalise)
    if len(trouves) != 1:
        return None  # zéro nombre, ou plusieurs : ambigu
    try:
        return float(trouves[0])
    except ValueError:
        return None


def _value_from_raw_answer(field: str, last_answer: str, current_profile: UserProfile) -> Any:
    answer = last_answer.strip()
    ans_lower = answer.lower()

    # Priorité absolue sur toute autre lecture : « aucune idée » contient « aucun », que la
    # liste de mots négatifs ci-dessous lirait comme « non ». Une non-réponse ne doit jamais
    # devenir une réponse — elle sera consignée dans `unknown_fields` par `apply_updates`.
    if _UNKNOWN_RE.search(answer):
        return None

    if field in LIST_FIELDS:
        return _coerce_value(field, [answer], current_profile)

    if field in _ENUM_FIELDS or field in NUMBER_FIELDS:
        return _coerce_value(field, answer, current_profile)

    if field in BOOL_FIELDS:
        # Mots-clés génériques (oui/non explicites) + vocabulaire concret des exemples donnés
        # dans les questions (ex: "partenariats rémunérés, vente, monétisation directe") :
        # décrire sa situation avec ces mots revient à confirmer la question, même sans "oui"
        # explicite — utile en filet de secours quand le LLM d'extraction est indisponible
        # (ex: quota API épuisé), pour ne pas boucler sur une réponse pourtant valable.
        if any(
            k in ans_lower
            for k in (
                "oui", "yes", "vrai", "régulièrement", "parfois", "chaque", "commercial",
                "partenariat", "sponsoring", "affiliation", "monétisation", "monetisation",
                "vente", "rémunér", "remunér", "publicité", "publicite", "collab",
            )
        ):
            return True
        if any(
            k in ans_lower
            for k in ("non", "no", "faux", "jamais", "seule", "aucun", "aucune", "rien")
        ):
            return False
        return None

    if field == "revenue_variability":
        return _coerce_value(field, answer, current_profile)

    return answer or None


def apply_updates(
    profile: UserProfile,
    updates: dict[str, Any],
    *,
    target_field: str | None = None,
    last_answer: str | None = None,
) -> UserProfile:
    """Merge LLM/raw updates into profile with type coercion."""
    profile_dict = profile.model_dump()

    for field, value in updates.items():
        if field not in _PROFILE_QUESTION_FIELDS:
            continue
        coerced = _coerce_value(field, value, profile)
        if coerced is not None:
            profile_dict[field] = coerced

    if target_field and target_field in _PROFILE_QUESTION_FIELDS and last_answer:
        curr = profile_dict.get(target_field)
        if curr in (None, [], ""):
            fallback = _value_from_raw_answer(target_field, last_answer, profile)
            if fallback is not None:
                profile_dict[target_field] = fallback

        # Toujours pas de valeur, et l'utilisateur dit ne pas savoir : on le CONSIGNE. Sans
        # cela, `next_missing_field` reposerait éternellement la même question.
        if profile_dict.get(target_field) in (None, [], "") and _UNKNOWN_RE.search(last_answer):
            inconnus = list(profile_dict.get("unknown_fields") or [])
            if target_field not in inconnus:
                inconnus.append(target_field)
            profile_dict["unknown_fields"] = inconnus

    try:
        return UserProfile.model_validate(profile_dict)
    except Exception as e:
        logger.error("Validation error when merging profile updates: %s", e)
        return profile
