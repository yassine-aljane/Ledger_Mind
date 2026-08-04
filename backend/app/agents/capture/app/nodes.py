"""Nœuds LangGraph (un par étape) + routage conditionnel + point d'entrée Q&A.

Les dépendances (client Mistral, base) sont injectées via un conteneur `Deps`
lié aux nœuds par `functools.partial` dans graph.py — ce qui rend les nœuds
testables sans singletons globaux.
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from langgraph.types import interrupt  # HITL
from pydantic import ValidationError

from . import prompts
from . import fx
from .config import (
    CONTRACT_TYPES,
    CONTRAT_MANDATORY_FIELDS,
    EXPENSE_CATEGORIES,
    MANDATORY_FIELDS,
    MODEL_LARGE,
    MODEL_SMALL,
    VIREMENT_MANDATORY_FIELDS,
)
from .db import (
    Database,
    DuplicateContratError,
    DuplicateInvoiceError,
    DuplicateVirementError,
)
from .mistral_client import MistralClient
from .schemas import BankTransfer, Cadeau, Contract, ContractParty, Invoice, LineItem


logger = logging.getLogger(__name__)


@dataclass
class Deps:
    mistral: MistralClient
    db: Database


_WRITING_MODES = {"imprime", "manuscrit", "mixte"}


def _pop_reading_hints(data: Any, champs_connus: Any) -> Dict[str, Any]:
    """Extrait `_writing_mode` / `_uncertain` du JSON d'extraction.

    Ces deux clés décrivent la LECTURE, pas le document : elles sont retirées
    avant validation du modèle métier, qui les rejetterait. Les noms de champs
    inventés par le modèle sont écartés au passage.
    """
    if not isinstance(data, dict):
        return {"writing_mode": None, "uncertain_fields": []}

    mode = str(data.pop("_writing_mode", "") or "").strip().lower()
    brut = data.pop("_uncertain", None) or []
    connus = set(champs_connus)
    uncertain = [f for f in brut if isinstance(f, str) and f in connus]
    return {
        "writing_mode": mode if mode in _WRITING_MODES else None,
        "uncertain_fields": uncertain,
    }


def _a_confirmer(state: Dict[str, Any], field: str, valeurs: Dict[str, Any]) -> bool:
    """Vrai si le champ a été LU mais reste douteux (donc à confirmer, pas à saisir)."""
    return field in set(state.get("uncertain_fields") or []) and valeurs.get(field) not in (None, "")


def _question_hitl(state: Dict[str, Any], field: str, valeurs: Dict[str, Any],
                   suggestions: List[str], labels: Dict[str, str] = None):
    """Question et candidats du HITL, selon que le champ manque ou soit douteux."""
    if _a_confirmer(state, field, valeurs):
        lu = valeurs[field]
        # La valeur lue passe en tête : confirmer doit être le geste le plus court.
        candidats = [str(lu)] + [s for s in suggestions if str(s) != str(lu)]
        return prompts.confirm_uncertain_field(field, lu, labels=labels), candidats, "champ_a_confirmer"
    return prompts.ask_missing_field(field, valeurs, labels=labels), suggestions, "champ_manquant"


def _keep_original(state: Dict[str, Any], deps: Deps) -> bool:
    """Conserve la pièce d'origine pour un réaffichage ultérieur.

    Étape annexe : son échec ne doit jamais empêcher l'enregistrement de
    l'extraction, seule donnée réellement produite par le traitement.
    """
    b64 = state.get("file_b64")
    if not b64:
        return False
    try:
        data = base64.b64decode(b64)
    except (binascii.Error, ValueError) as exc:
        logger.warning("Pièce d'origine illisible (document %s) : %s", state.get("document_id"), exc)
        return False
    return deps.db.save_original_file(
        state["user_id"],
        state["document_id"],
        data,
        filename=state.get("filename"),
        mime=state.get("mime"),
    )


# ---------------------------------------------------------------------------
# Helpers de coercition (réponses HITL = autorité de l'utilisateur, FR-08)
# ---------------------------------------------------------------------------
_SKIP_WORDS = {"passer", "skip", "ignorer", "aucun", ""}


def _parse_amount(value: str) -> Optional[float]:
    cleaned = re.sub(r"[^\d,.\-]", "", value).replace(" ", "")
    if not cleaned:
        return None
    # virgule décimale française -> point
    if "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_date(value: str) -> Optional[str]:
    value = value.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return value or None


def _coerce_field(field: str, value: str) -> Any:
    value = value.strip()
    if field in {"total_ttc", "subtotal_ht", "vat_amount", "amount"}:
        return _parse_amount(value)
    if field in {"issue_date", "execution_date", "value_date",
                 "signature_date", "start_date", "end_date"}:
        return _parse_date(value)
    if field in {"duration_months", "notice_period_days"}:
        montant = _parse_amount(value)
        return int(montant) if montant is not None else None
    if field == "contract_type":
        # Une saisie hors nomenclature est classée "autre" : mieux vaut une
        # pièce grossièrement rangée qu'un type de contrat inventé.
        normalise = value.lower()
        return (normalise if normalise in CONTRACT_TYPES else "autre") if value else None
    if field in {"paid", "is_open_ended"}:
        return _parse_bool(value)
    return value or None


_OUI = {"oui", "o", "yes", "y", "true", "vrai", "1", "réglée", "reglee", "payée", "payee"}
_NON = {"non", "n", "no", "false", "faux", "0", "impayée", "impayee"}


def _parse_bool(value: str) -> Optional[bool]:
    """Booléen d'une réponse humaine ; `None` si la réponse ne tranche pas."""
    v = value.strip().lower()
    if v in _OUI:
        return True
    if v in _NON:
        return False
    return None


def _safe_invoice(data: Any) -> Invoice:
    """Construit un Invoice tolérant : sur erreur, on isole ligne par ligne."""
    if not isinstance(data, dict):
        return Invoice()
    try:
        return Invoice.model_validate(data)
    except ValidationError:
        clean = {f: data.get(f) for f in Invoice.model_fields if f != "line_items"}
        inv = Invoice.model_validate(clean)
        items: List[LineItem] = []
        for it in (data.get("line_items") or []):
            try:
                items.append(LineItem.model_validate(it))
            except ValidationError:
                continue
        inv.line_items = items
        return inv


def _compute_missing(inv: Invoice) -> List[str]:
    return [f for f in MANDATORY_FIELDS if getattr(inv, f) in (None, "")]


def _compute_missing_virement(vir: BankTransfer) -> List[str]:
    return [f for f in VIREMENT_MANDATORY_FIELDS if getattr(vir, f) in (None, "")]


def _compute_missing_contrat(c: Contract) -> List[str]:
    return [f for f in CONTRAT_MANDATORY_FIELDS if getattr(c, f) in (None, "")]


# ---------------------------------------------------------------------------
# Vérifications DÉTERMINISTES (aucun LLM) : cohérence arithmétique + paiement
# ---------------------------------------------------------------------------
def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(str(value).strip(), fmt)
        except ValueError:
            continue
    return None


def _fmt_fr(value: Any) -> str:
    d = _parse_iso(value)
    return d.strftime("%d/%m/%Y") if d else str(value)


def days_until(value: Any) -> Optional[int]:
    """Nombre de jours (calendaires) d'ici la date donnée. Négatif si passée."""
    d = _parse_iso(value)
    return (d.date() - date.today()).days if d else None


def _close(a: float, b: float) -> bool:
    """Égalité monétaire tolérante (2 % ou 1 centime, le plus grand)."""
    return abs(a - b) <= max(0.01, 0.02 * max(abs(a), abs(b)))


def compute_incoherences(inv: Invoice) -> List[str]:
    """Anomalies arithmétiques/structurelles d'une facture (déterministe)."""
    issues: List[str] = []
    st, tva, ttc = inv.subtotal_ht, inv.vat_amount, inv.total_ttc

    if st is not None and tva is not None and ttc is not None and not _close(st + tva, ttc):
        issues.append(
            f"Total incohérent : HT {st} + TVA {tva} = {round(st + tva, 2)} ≠ TTC {ttc}."
        )
    # Somme des lignes vs sous-total HT
    line_totals = [li.total for li in inv.line_items if li.total is not None]
    if st is not None and line_totals and not _close(sum(line_totals), st):
        issues.append(
            f"Somme des lignes {round(sum(line_totals), 2)} ≠ sous-total HT {st}."
        )
    # Cohérence de chaque ligne : quantité × prix unitaire = total
    for i, li in enumerate(inv.line_items, 1):
        if li.quantity is not None and li.unit_price is not None and li.total is not None:
            if not _close(li.quantity * li.unit_price, li.total):
                issues.append(
                    f"Ligne {i} : {li.quantity} × {li.unit_price} = "
                    f"{round(li.quantity * li.unit_price, 2)} ≠ total {li.total}."
                )
    # Montants négatifs
    for field, lib in (("subtotal_ht", "sous-total HT"), ("vat_amount", "TVA"), ("total_ttc", "total TTC")):
        v = getattr(inv, field)
        if v is not None and v < 0:
            issues.append(f"Montant négatif suspect ({lib} = {v}).")
    # Devise absente alors que des montants existent
    if ttc is not None and not inv.currency:
        issues.append("Devise absente alors que des montants sont présents.")
    return issues


def compute_payment(inv: Invoice) -> Dict[str, Any]:
    """Statut de paiement + échéance déterministe.

    Date d'échéance = due_date explicite, sinon date d'émission + délai (jours).
    Produit une NOTE en français reprise telle quelle dans l'analyse.
    """
    due = inv.due_date
    if not due and inv.issue_date and inv.payment_terms_days:
        base = _parse_iso(inv.issue_date)
        if base:
            due = (base + timedelta(days=int(inv.payment_terms_days))).strftime("%Y-%m-%d")

    d_until = days_until(due) if due else None
    note: Optional[str] = None
    if inv.paid is True:
        note = "Facture déjà réglée."
    elif due:
        j = _fmt_fr(due)
        if d_until is None:
            note = f"Facture non payée — à régler le {j}."
        elif d_until >= 0:
            note = f"Facture non payée — à régler le {j} (dans {d_until} jour(s))."
        else:
            note = f"Facture non payée — échéance dépassée le {j} (retard de {-d_until} jour(s))."
    elif inv.paid is False:
        note = "Facture non payée — échéance non précisée."

    return {"paid": inv.paid, "payment_date": due, "days_until": d_until, "note": note}


def _iban_valid(iban: str) -> bool:
    """Validation de la clé de contrôle IBAN (norme ISO 13616, mod 97)."""
    s = re.sub(r"\s+", "", iban or "").upper()
    if not re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}", s):
        return False
    # Déplace les 4 premiers caractères à la fin, convertit lettres -> nombres.
    rearranged = s[4:] + s[:4]
    digits = "".join(str(int(c, 36)) for c in rearranged)  # 0-9 inchangés, A=10..Z=35
    try:
        return int(digits) % 97 == 1
    except ValueError:
        return False


def compute_virement_incoherences(t: BankTransfer) -> List[str]:
    """Anomalies d'un virement (déterministe) : montant, IBAN, devise."""
    issues: List[str] = []
    if t.amount is not None and t.amount <= 0:
        issues.append(f"Montant du virement invalide ({t.amount}).")
    for lib, iban in (("émetteur", t.sender_iban), ("bénéficiaire", t.beneficiary_iban)):
        if iban and not _iban_valid(iban):
            issues.append(f"IBAN {lib} invalide (clé de contrôle incorrecte) : {iban}.")
    if t.amount is not None and not t.currency:
        issues.append("Devise absente alors qu'un montant est présent.")
    return issues


def compute_contrat_incoherences(c: Contract) -> List[str]:
    """Anomalies d'un contrat (déterministe, aucun LLM) : dates, durée, parties.

    Ces contrôles portent sur la COHÉRENCE INTERNE du document, jamais sur la
    validité juridique des clauses — qui ne se décide pas par calcul.
    """
    issues: List[str] = []

    debut = _parse_iso(c.start_date)
    fin = _parse_iso(c.end_date)
    signature = _parse_iso(c.signature_date)

    if debut and fin and fin < debut:
        issues.append(
            f"Date de fin ({_fmt_fr(c.end_date)}) antérieure à la prise d'effet "
            f"({_fmt_fr(c.start_date)})."
        )
    if signature and debut and signature > debut:
        issues.append(
            f"Contrat signé le {_fmt_fr(c.signature_date)}, soit après sa prise "
            f"d'effet du {_fmt_fr(c.start_date)}."
        )
    if c.is_open_ended and c.end_date:
        issues.append("Contrat annoncé à durée indéterminée mais une date de fin est indiquée.")
    if c.duration_months is not None and c.duration_months <= 0:
        issues.append(f"Durée invalide ({c.duration_months} mois).")
    # Durée annoncée contre durée réelle : tolérance d'un mois pour absorber
    # les arrondis de calendrier (mois de 28 à 31 jours).
    if c.duration_months and debut and fin:
        mois_reels = (fin.year - debut.year) * 12 + (fin.month - debut.month)
        if abs(mois_reels - c.duration_months) > 1:
            issues.append(
                f"Durée annoncée ({c.duration_months} mois) incompatible avec les "
                f"dates du contrat ({mois_reels} mois)."
            )
    if c.notice_period_days is not None and c.notice_period_days < 0:
        issues.append(f"Préavis négatif ({c.notice_period_days} jours).")
    if c.amount is not None and c.amount <= 0:
        issues.append(f"Montant de la contrepartie invalide ({c.amount}).")
    if c.amount is not None and not c.currency:
        issues.append("Devise absente alors qu'un montant est présent.")

    nommees = [p for p in c.parties if p.name]
    if len(nommees) < 2:
        issues.append(
            f"{len(nommees)} partie identifiée sur les deux attendues au minimum."
            if len(nommees) == 1
            else "Aucune partie signataire identifiée."
        )

    # Échéance dépassée : information utile au suivi, pas une erreur du document.
    if fin:
        restant = days_until(c.end_date)
        if restant is not None and restant < 0:
            issues.append(f"Contrat arrivé à échéance depuis {abs(restant)} jours.")

    return issues


def _safe_contrat(data: Any) -> Contract:
    """Construit un Contract tolérant : sur erreur, on isole les listes."""
    if not isinstance(data, dict):
        return Contract()
    try:
        return Contract.model_validate(data)
    except ValidationError:
        clean = {f: data.get(f) for f in Contract.model_fields if f not in ("parties", "obligations")}
        try:
            c = Contract.model_validate(clean)
        except ValidationError:
            return Contract()
        # Les parties sont revalidées une à une : une entrée malformée ne doit
        # pas faire perdre les signataires correctement lus.
        parties: List[ContractParty] = []
        for raw in data.get("parties") or []:
            try:
                parties.append(ContractParty.model_validate(raw))
            except ValidationError:
                continue
        c.parties = parties
        c.obligations = [str(o) for o in (data.get("obligations") or []) if o]
        return c


def _safe_virement(data: Any) -> BankTransfer:
    """Construit un BankTransfer tolérant : sur erreur, champ par champ."""
    if not isinstance(data, dict):
        return BankTransfer()
    try:
        return BankTransfer.model_validate(data)
    except ValidationError:
        clean = {f: data.get(f) for f in BankTransfer.model_fields}
        try:
            return BankTransfer.model_validate(clean)
        except ValidationError:
            return BankTransfer()


# ---------------------------------------------------------------------------
# Nœuds du graphe principal
# ---------------------------------------------------------------------------
def ocr_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """OCR de la facture. Le contenu source est passé en base64 dans l'état."""
    import base64

    b64 = state["file_b64"]
    mime = state.get("mime") or "application/pdf"
    data = base64.b64decode(b64)
    text = deps.mistral.ocr(data, mime)
    return {"ocr_text": text, "ocr_text_original": text, "status": "en_cours"}


def detect_language_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    system, user = prompts.detect_language(state["ocr_text"])
    # Bascule sur le grand modèle si `small` est saturé (429 capacity).
    result = deps.mistral.chat_json(MODEL_SMALL, system, user, fallback_model=MODEL_LARGE)
    lang = str(result.get("language", "")).lower()[:2] or "fr"
    return {"detected_language": lang}


def translate_to_fr_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Traduit le texte OCR en français avant tout traitement aval (FR-14)."""
    system, user = prompts.translate_to_fr(state["ocr_text"])
    fr = deps.mistral.chat_text(MODEL_LARGE, system, user)
    return {"ocr_text": fr}  # ocr_text_original conserve la version d'origine


def detect_document_type_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Détermine si le document est une facture, un virement, un contrat — ou rien de tout cela.

    Une réponse inattendue est traitée comme « autre » et NON rabattue sur
    « facture ». Un document mal classé traverserait toute la chaîne pour
    produire des montants inventés : dire qu'on n'a pas reconnu la pièce est
    exact dans les deux cas, et sans conséquence sur les données.
    """
    system, user = prompts.detect_document_type(state["ocr_text"])
    result = deps.mistral.chat_json(MODEL_SMALL, system, user, fallback_model=MODEL_LARGE)
    dtype = str(result.get("type", "")).strip().lower()
    if dtype not in ("facture", "virement", "contrat"):
        dtype = "autre"
    out: Dict[str, Any] = {"document_type": dtype}
    if dtype == "autre":
        nature = result.get("nature")
        out["detected_nature"] = str(nature).strip() if nature else None
    return out


def reject_unsupported_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Clôt le parcours d'un document qui ne relève d'aucun type traité.

    Rien n'est extrait, analysé ni enregistré : il n'y a pas de données
    fiables à en tirer. Le document est simplement rendu à l'utilisateur avec
    une explication.
    """
    nature = state.get("detected_nature")
    precision = f" (il semble s'agir de : {nature})" if nature else ""
    return {
        "status": "non_pris_en_charge",
        "saved": False,
        "message": (
            f"Ce document n'est ni une facture, ni un justificatif de virement, "
            f"ni un contrat{precision}. Il n'a donc pas été enregistré."
        ),
    }


def extract_fields_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    system, user = prompts.extract_fields(state["ocr_text"])
    data = deps.mistral.chat_json(MODEL_LARGE, system, user)
    lecture = _pop_reading_hints(data, Invoice.model_fields)
    inv = _safe_invoice(data)
    # Un champ lu mais douteux rejoint la file du HITL, au même titre qu'un
    # champ absent : dans les deux cas la valeur ne peut pas être retenue sans
    # accord humain. Seule la question posée diffère.
    missing = _compute_missing(inv)
    missing += [f for f in lecture["uncertain_fields"] if f not in missing]
    out: Dict[str, Any] = {"invoice": inv.model_dump(), "missing_fields": missing, **lecture}
    # Suggestions calculées ICI (une seule fois) : le nœud d'interruption se
    # ré-exécute à chaque reprise et ne doit donc PAS relancer d'appel LLM.
    if missing:
        out["field_suggestions"] = _suggest_fields(deps, missing, state["ocr_text"], inv.model_dump())
    return out


def _suggest_fields(deps: Deps, fields: List[str], ocr_text: str, invoice: Dict[str, Any],
                    labels: Dict[str, str] = None) -> Dict[str, List[str]]:
    """Propose des valeurs candidates par champ manquant (jamais retenues sans
    approbation humaine). Tolérant aux pannes : en cas d'échec, aucune suggestion
    — le HITL en saisie libre reste disponible."""
    try:
        system, user = prompts.suggest_field_values(fields, ocr_text, invoice, labels=labels)
        result = deps.mistral.chat_json(MODEL_LARGE, system, user)
    except Exception:  # noqa: BLE001 - fonctionnalité d'assistance, non bloquante
        return {}
    out: Dict[str, List[str]] = {}
    for f in fields:
        raw = result.get(f)
        if isinstance(raw, list):
            vals = [str(v).strip() for v in raw if str(v).strip()]
        elif isinstance(raw, (str, int, float)) and str(raw).strip():
            vals = [str(raw).strip()]
        else:
            vals = []
        if vals:
            out[f] = vals[:3]
    return out


def ask_missing_field_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Interrompt le graphe pour demander UN champ manquant à l'utilisateur.

    >>> ZONE DÉLICATE #2 — interruption LangGraph (human-in-the-loop) <<<
    `interrupt(payload)` suspend l'exécution et remonte `payload` à l'appelant
    (l'API renvoie alors un état `en_attente_utilisateur`). Le thread est figé
    par le checkpointer. Sur `POST /answer`, on reprend avec
    `Command(resume=<réponse>)` : LangGraph RÉEXÉCUTE ce nœud depuis le début,
    et cette fois `interrupt(...)` RENVOIE la valeur de reprise au lieu de
    suspendre. Tout code situé avant `interrupt` doit donc rester sans effet de
    bord (ici : simple lecture d'état). Un champ est traité par tour ; le
    routage reboucle tant qu'il reste des champs manquants.
    """
    missing = list(state.get("missing_fields") or [])
    invoice = dict(state.get("invoice") or {})
    if not missing:
        return {}

    field = missing[0]
    # Lecture PURE de l'état (suggestions pré-calculées) : sûr à la ré-exécution.
    suggestions = (state.get("field_suggestions") or {}).get(field, [])
    question, candidats, type_demande = _question_hitl(state, field, invoice, suggestions)
    answer = interrupt(
        {"type": type_demande, "field": field, "question": question, "suggestions": candidats}
    )

    remaining = missing[1:]
    if answer is not None and str(answer).strip().lower() not in _SKIP_WORDS:
        invoice[field] = _coerce_field(field, str(answer))
    return {"invoice": invoice, "missing_fields": remaining}


def write_analysis_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    # Vérifications déterministes AVANT l'analyse : leurs résultats sont des
    # faits fournis au LLM (dates/incohérences déjà calculées, non recalculées).
    inv = _safe_invoice(state.get("invoice") or {})
    incoherences = compute_incoherences(inv)
    payment = compute_payment(inv)
    # Unification devise (déterministe, jamais bloquant) : montant TTC converti en EUR.
    inv.amount_eur, inv.exchange_rate, inv.rate_source = fx.enrich_amount_eur(
        deps.db, inv.total_ttc, inv.currency, inv.issue_date
    )
    inv.rate_date = inv.issue_date if inv.amount_eur is not None else None
    system, user = prompts.write_analysis(
        state["ocr_text"], state["invoice"],
        payment_note=payment.get("note"), incoherences=incoherences,
        writing_mode=state.get("writing_mode"),
        confirmed=state.get("uncertain_fields"),
    )
    analysis = deps.mistral.chat_text(MODEL_LARGE, system, user)
    return {
        "invoice": inv.model_dump(),
        "analysis": analysis,
        "incoherences": incoherences,
        "payment": payment,
    }


def classify_expense_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    system, user = prompts.classify_expense(state["ocr_text"], state["invoice"])
    # Bascule sur le grand modèle si `small` est saturé (429 capacity).
    result = deps.mistral.chat_json(MODEL_SMALL, system, user, fallback_model=MODEL_LARGE)
    category = str(result.get("category", "")).strip().lower()
    if category not in EXPENSE_CATEGORIES:
        category = "autre"
    return {"expense_category": category}


def check_duplicate_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Recherche un doublon (FR-12). Si trouvé : interruption pour confirmation
    humaine — jamais de rejet automatique."""
    inv = _safe_invoice(state.get("invoice") or {})
    existing = deps.db.find_duplicate(state["user_id"], inv.dedup_key())
    if not existing:
        return {"duplicate_candidate": None, "duplicate_decision": "distinct"}

    existing_clean = {k: v for k, v in existing.items() if k != "_id"}
    decision = interrupt(
        {
            "type": "doublon",
            "question": (
                "Une facture très similaire existe déjà. S'agit-il d'un doublon ? "
                "(répondez « oui » pour ignorer, « non » pour l'enregistrer quand même)"
            ),
            "existing_invoice": existing_clean.get("invoice", existing_clean),
            "new_invoice": state.get("invoice"),
        }
    )
    d = str(decision).strip().lower()
    confirme = d in {"oui", "o", "yes", "y", "confirmer", "doublon", "true", "1"}
    return {
        "duplicate_candidate": existing_clean,
        "duplicate_decision": "confirme" if confirme else "distinct",
    }


def save_to_db_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Persiste la facture (sauf doublon confirmé) et initialise la session chat."""
    if state.get("duplicate_decision") == "confirme":
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    inv = _safe_invoice(state.get("invoice") or {})
    payment = state.get("payment") or {}
    has_file = _keep_original(state, deps)
    doc = {
        "user_id": state["user_id"],
        "document_id": state["document_id"],
        "document_type": "facture",
        "filename": state.get("filename"),
        "mime": state.get("mime"),
        "has_file": has_file,
        "invoice": inv.model_dump(),
        "analysis": state.get("analysis"),
        "expense_category": state.get("expense_category"),
        "incoherences": state.get("incoherences") or [],
        # Paiement : on stocke la date d'échéance (absolue) ; le nombre de jours
        # restant est recalculé à la lecture pour rester à jour.
        "paid": payment.get("paid"),
        "payment_date": payment.get("payment_date"),
        "payment_note": payment.get("note"),
        "ocr_text": state.get("ocr_text"),
        "ocr_text_original": state.get("ocr_text_original"),
        "detected_language": state.get("detected_language"),
        # Traçabilité de la lecture : une valeur issue d'un manuscrit et
        # confirmée à la main n'a pas le même statut qu'une valeur imprimée.
        "writing_mode": state.get("writing_mode"),
        "uncertain_fields": state.get("uncertain_fields") or [],
        # Champs de la clé unique remontés au niveau racine (index UNIQUE).
        "invoice_number": inv.invoice_number,
        "issuer_tax_id": inv.issuer_tax_id,
        "total_ttc": inv.total_ttc,
        "issue_date": inv.issue_date,
    }
    try:
        deps.db.insert_invoice(doc)
    except DuplicateInvoiceError:
        # Course entre le check et l'insert : on traite comme doublon.
        deps.db.delete_original_file(state["user_id"], state["document_id"])
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    if state.get("analysis"):
        deps.db.append_messages(
            state["user_id"],
            state["document_id"],
            [{"role": "assistant", "content": state["analysis"]}],
        )
    return {"status": "completed", "saved": True, "duplicate_skipped": False}


# ---------------------------------------------------------------------------
# Branche VIREMENT BANCAIRE (extraction -> analyse -> sauvegarde)
# ---------------------------------------------------------------------------
def extract_virement_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    system, user = prompts.extract_virement(state["ocr_text"])
    data = deps.mistral.chat_json(MODEL_LARGE, system, user)
    if isinstance(data, dict):
        # Normalisations déterministes : montant FR, dates ISO, IBAN sans espaces.
        if isinstance(data.get("amount"), str):
            data["amount"] = _parse_amount(data["amount"])
        for k in ("execution_date", "value_date"):
            if isinstance(data.get(k), str):
                data[k] = _parse_date(data[k])
        for k in ("sender_iban", "beneficiary_iban", "beneficiary_bic"):
            if isinstance(data.get(k), str):
                data[k] = re.sub(r"\s+", "", data[k]).upper() or None
    lecture = _pop_reading_hints(data, BankTransfer.model_fields)
    vir = _safe_virement(data)
    missing = _compute_missing_virement(vir)
    missing += [f for f in lecture["uncertain_fields"] if f not in missing]
    out: Dict[str, Any] = {
        "virement": vir.model_dump(), "virement_missing_fields": missing, **lecture,
    }
    if missing:  # suggestions calculées une seule fois (cf. HITL facture)
        out["virement_field_suggestions"] = _suggest_fields(
            deps, missing, state["ocr_text"], vir.model_dump(),
            labels=prompts.VIREMENT_FIELD_LABELS,
        )
    return out


def ask_missing_virement_field_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """HITL champ manquant d'un virement (interrupt + boucle). Voir zone délicate
    #2 : lecture PURE de l'état avant `interrupt`, sûre à la ré-exécution."""
    missing = list(state.get("virement_missing_fields") or [])
    vir = dict(state.get("virement") or {})
    if not missing:
        return {}
    field = missing[0]
    suggestions = (state.get("virement_field_suggestions") or {}).get(field, [])
    question, candidats, type_demande = _question_hitl(
        state, field, vir, suggestions, labels=prompts.VIREMENT_FIELD_LABELS
    )
    answer = interrupt(
        {"type": type_demande, "field": field, "question": question, "suggestions": candidats}
    )
    remaining = missing[1:]
    if answer is not None and str(answer).strip().lower() not in _SKIP_WORDS:
        vir[field] = _coerce_field(field, str(answer))
    return {"virement": vir, "virement_missing_fields": remaining}


def analyze_virement_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    vir = _safe_virement(state.get("virement") or {})
    incoherences = compute_virement_incoherences(vir)  # déterministe (IBAN, montant)
    # Unification devise (déterministe, jamais bloquant) : montant converti en EUR.
    vir.amount_eur, vir.exchange_rate, vir.rate_source = fx.enrich_amount_eur(
        deps.db, vir.amount, vir.currency, vir.execution_date
    )
    vir.rate_date = vir.execution_date if vir.amount_eur is not None else None
    system, user = prompts.write_virement_analysis(
        state["ocr_text"], state["virement"], incoherences,
        writing_mode=state.get("writing_mode"),
        confirmed=state.get("uncertain_fields"),
    )
    analysis = deps.mistral.chat_text(MODEL_LARGE, system, user)
    return {"virement": vir.model_dump(), "analysis": analysis, "incoherences": incoherences}


def check_duplicate_virement_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Recherche un virement doublon ; si trouvé, interruption pour confirmation
    humaine (jamais de rejet automatique), comme pour les factures."""
    vir = _safe_virement(state.get("virement") or {})
    existing = deps.db.find_duplicate_virement(state["user_id"], vir.dedup_key())
    if not existing:
        return {"duplicate_candidate": None, "duplicate_decision": "distinct"}

    existing_clean = {k: v for k, v in existing.items() if k != "_id"}
    decision = interrupt(
        {
            "type": "doublon",
            "question": (
                "Un virement très similaire existe déjà. S'agit-il d'un doublon ? "
                "(répondez « oui » pour ignorer, « non » pour l'enregistrer quand même)"
            ),
            "existing_invoice": existing_clean.get("transfer", existing_clean),
            "new_invoice": state.get("virement"),
        }
    )
    d = str(decision).strip().lower()
    confirme = d in {"oui", "o", "yes", "y", "confirmer", "doublon", "true", "1"}
    return {
        "duplicate_candidate": existing_clean,
        "duplicate_decision": "confirme" if confirme else "distinct",
    }


def save_virement_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Persiste le virement (sauf doublon confirmé) et initialise la session chat."""
    if state.get("duplicate_decision") == "confirme":
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    vir = _safe_virement(state.get("virement") or {})
    has_file = _keep_original(state, deps)
    doc = {
        "user_id": state["user_id"],
        "document_id": state["document_id"],
        "document_type": "virement",
        "filename": state.get("filename"),
        "mime": state.get("mime"),
        "has_file": has_file,
        "transfer": vir.model_dump(),
        "analysis": state.get("analysis"),
        "incoherences": state.get("incoherences") or [],
        "ocr_text": state.get("ocr_text"),
        "ocr_text_original": state.get("ocr_text_original"),
        "detected_language": state.get("detected_language"),
        # Traçabilité de la lecture : une valeur issue d'un manuscrit et
        # confirmée à la main n'a pas le même statut qu'une valeur imprimée.
        "writing_mode": state.get("writing_mode"),
        "uncertain_fields": state.get("uncertain_fields") or [],
        # Champs de la clé unique remontés au niveau racine (index UNIQUE).
        "transfer_reference": vir.transfer_reference,
        "amount": vir.amount,
        "execution_date": vir.execution_date,
    }
    try:
        deps.db.insert_virement(doc)
    except DuplicateVirementError:
        deps.db.delete_original_file(state["user_id"], state["document_id"])
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    if state.get("analysis"):
        deps.db.append_messages(
            state["user_id"],
            state["document_id"],
            [{"role": "assistant", "content": state["analysis"]}],
        )
    return {"status": "completed", "saved": True, "duplicate_skipped": False}


def route_after_extract_virement(state: Dict[str, Any]) -> str:
    return "ask_missing_virement_field" if state.get("virement_missing_fields") else "analyze_virement"


def route_after_ask_virement(state: Dict[str, Any]) -> str:
    return "ask_missing_virement_field" if state.get("virement_missing_fields") else "analyze_virement"


# ---------------------------------------------------------------------------
# Branche CONTRAT (extraction -> HITL -> analyse -> dédup -> sauvegarde)
# ---------------------------------------------------------------------------
def extract_contrat_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    system, user = prompts.extract_contrat(state["ocr_text"])
    data = deps.mistral.chat_json(MODEL_LARGE, system, user)
    if isinstance(data, dict):
        # Normalisations déterministes : montant FR, dates ISO, type contrôlé.
        if isinstance(data.get("amount"), str):
            data["amount"] = _parse_amount(data["amount"])
        for k in ("signature_date", "start_date", "end_date"):
            if isinstance(data.get(k), str):
                data[k] = _parse_date(data[k])
        for k in ("duration_months", "notice_period_days"):
            if isinstance(data.get(k), str):
                montant = _parse_amount(data[k])
                data[k] = int(montant) if montant is not None else None
        # Un type hors nomenclature est ramené à "autre" plutôt qu'inventé.
        ctype = data.get("contract_type")
        if isinstance(ctype, str):
            normalise = ctype.strip().lower()
            data["contract_type"] = normalise if normalise in CONTRACT_TYPES else "autre"

    lecture = _pop_reading_hints(data, Contract.model_fields)
    contrat = _safe_contrat(data)
    missing = _compute_missing_contrat(contrat)
    missing += [f for f in lecture["uncertain_fields"] if f not in missing]
    out: Dict[str, Any] = {
        "contrat": contrat.model_dump(), "contrat_missing_fields": missing, **lecture,
    }
    if missing:  # suggestions calculées une seule fois (cf. HITL facture)
        out["contrat_field_suggestions"] = _suggest_fields(
            deps, missing, state["ocr_text"], contrat.model_dump(),
            labels=prompts.CONTRAT_FIELD_LABELS,
        )
    return out


def ask_missing_contrat_field_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """HITL champ manquant d'un contrat (interrupt + boucle). Lecture PURE de
    l'état avant `interrupt`, sûre à la ré-exécution."""
    missing = list(state.get("contrat_missing_fields") or [])
    contrat = dict(state.get("contrat") or {})
    if not missing:
        return {}
    field = missing[0]
    suggestions = (state.get("contrat_field_suggestions") or {}).get(field, [])
    # La nature du contrat est un choix fermé : on propose la nomenclature
    # plutôt qu'une saisie libre que la validation ramènerait à "autre".
    if field == "contract_type" and not suggestions:
        suggestions = list(CONTRACT_TYPES)
    question, candidats, type_demande = _question_hitl(
        state, field, contrat, suggestions, labels=prompts.CONTRAT_FIELD_LABELS
    )
    answer = interrupt(
        {"type": type_demande, "field": field, "question": question, "suggestions": candidats}
    )
    remaining = missing[1:]
    if answer is not None and str(answer).strip().lower() not in _SKIP_WORDS:
        contrat[field] = _coerce_field(field, str(answer))
    return {"contrat": contrat, "contrat_missing_fields": remaining}


def analyze_contrat_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    contrat = _safe_contrat(state.get("contrat") or {})
    incoherences = compute_contrat_incoherences(contrat)  # déterministe
    # Unification devise : la contrepartie est convertie comme tout montant,
    # au taux de la date de signature (à défaut, de prise d'effet).
    reference_date = contrat.signature_date or contrat.start_date
    contrat.amount_eur, contrat.exchange_rate, contrat.rate_source = fx.enrich_amount_eur(
        deps.db, contrat.amount, contrat.currency, reference_date
    )
    contrat.rate_date = reference_date if contrat.amount_eur is not None else None
    system, user = prompts.write_contrat_analysis(
        state["ocr_text"], state["contrat"], incoherences,
        writing_mode=state.get("writing_mode"),
        confirmed=state.get("uncertain_fields"),
    )
    analysis = deps.mistral.chat_text(MODEL_LARGE, system, user)
    return {"contrat": contrat.model_dump(), "analysis": analysis, "incoherences": incoherences}


def check_duplicate_contrat_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Recherche un contrat doublon ; si trouvé, interruption pour confirmation
    humaine (jamais de rejet automatique), comme pour les autres pièces."""
    contrat = _safe_contrat(state.get("contrat") or {})
    existing = deps.db.find_duplicate_contrat(state["user_id"], contrat.dedup_key())
    if not existing:
        return {"duplicate_candidate": None, "duplicate_decision": "distinct"}

    existing_clean = {k: v for k, v in existing.items() if k != "_id"}
    decision = interrupt(
        {
            "type": "doublon",
            "question": (
                "Un contrat très similaire existe déjà. S'agit-il d'un doublon ? "
                "(répondez « oui » pour ignorer, « non » pour l'enregistrer quand même)"
            ),
            "existing_invoice": existing_clean.get("contract", existing_clean),
            "new_invoice": state.get("contrat"),
        }
    )
    d = str(decision).strip().lower()
    confirme = d in {"oui", "o", "yes", "y", "confirmer", "doublon", "true", "1"}
    return {
        "duplicate_candidate": existing_clean,
        "duplicate_decision": "confirme" if confirme else "distinct",
    }


def save_contrat_node(state: Dict[str, Any], deps: Deps) -> Dict[str, Any]:
    """Persiste le contrat (sauf doublon confirmé) et initialise la session chat."""
    if state.get("duplicate_decision") == "confirme":
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    contrat = _safe_contrat(state.get("contrat") or {})
    has_file = _keep_original(state, deps)
    doc = {
        "user_id": state["user_id"],
        "document_id": state["document_id"],
        "document_type": "contrat",
        "filename": state.get("filename"),
        "mime": state.get("mime"),
        "has_file": has_file,
        "contract": contrat.model_dump(),
        "analysis": state.get("analysis"),
        "incoherences": state.get("incoherences") or [],
        "ocr_text": state.get("ocr_text"),
        "ocr_text_original": state.get("ocr_text_original"),
        "detected_language": state.get("detected_language"),
        # Traçabilité de la lecture : une valeur issue d'un manuscrit et
        # confirmée à la main n'a pas le même statut qu'une valeur imprimée.
        "writing_mode": state.get("writing_mode"),
        "uncertain_fields": state.get("uncertain_fields") or [],
        # Champs de la clé unique remontés au niveau racine (index UNIQUE).
        "reference": contrat.reference,
        "contract_type": contrat.contract_type,
        "signature_date": contrat.signature_date,
        "amount": contrat.amount,
    }
    try:
        deps.db.insert_contrat(doc)
    except DuplicateContratError:
        deps.db.delete_original_file(state["user_id"], state["document_id"])
        return {"status": "completed", "saved": False, "duplicate_skipped": True}

    if state.get("analysis"):
        deps.db.append_messages(
            state["user_id"],
            state["document_id"],
            [{"role": "assistant", "content": state["analysis"]}],
        )
    return {"status": "completed", "saved": True, "duplicate_skipped": False}


def route_after_extract_contrat(state: Dict[str, Any]) -> str:
    return "ask_missing_contrat_field" if state.get("contrat_missing_fields") else "analyze_contrat"


def route_after_ask_contrat(state: Dict[str, Any]) -> str:
    return "ask_missing_contrat_field" if state.get("contrat_missing_fields") else "analyze_contrat"


# ---------------------------------------------------------------------------
# Fonctions de routage (arêtes conditionnelles)
# ---------------------------------------------------------------------------
def route_after_detect(state: Dict[str, Any]) -> str:
    lang = (state.get("detected_language") or "fr").lower()
    return "detect_document_type" if lang.startswith("fr") else "translate_to_fr"


def route_by_doc_type(state: Dict[str, Any]) -> str:
    """Aiguille vers la branche correspondant au type détecté.

    « autre » sort du graphe sans rien extraire : mieux vaut un document rendu
    à l'utilisateur qu'une extraction inventée sur une pièce hors périmètre.
    """
    return {
        "virement": "extract_virement",
        "contrat": "extract_contrat",
        "autre": "reject_unsupported",
    }.get(state.get("document_type"), "extract_fields")


def route_after_extract(state: Dict[str, Any]) -> str:
    return "ask_missing_field" if state.get("missing_fields") else "write_analysis"


def route_after_ask(state: Dict[str, Any]) -> str:
    return "ask_missing_field" if state.get("missing_fields") else "write_analysis"


# ---------------------------------------------------------------------------
# Correction humaine des champs extraits (point d'entrée hors graphe)
# ---------------------------------------------------------------------------
# Champs jamais modifiables à la main : soit dérivés d'un calcul déterministe
# (contre-valeur en euros, taux), soit structurés en listes que l'édition d'un
# champ ne sait pas représenter.
_NON_EDITABLES = {
    "amount_eur", "exchange_rate", "rate_date", "rate_source",
    "line_items", "parties", "obligations",
    # Sorties de l'estimation par vision : ce sont des observations de la machine,
    # pas des champs du document. L'utilisateur corrige la valeur RETENUE
    # (`valeur_ttc`) ; réécrire l'estimation effacerait la trace de ce que le
    # modèle avait proposé, et donc la possibilité de comparer les deux.
    "valeur_eur", "valeur_estimee", "fourchette_min", "fourchette_max",
    "confiance", "objet_identifie", "source_estimation", "valeur_corrigee",
}

# Champs dont la correction change le SENS de la pièce, et donc ce que la
# synthèse en dit. Corriger un BIC ou un matricule ne justifie pas de rejouer
# le modèle ; corriger un montant ou une date, si.
_CHAMPS_SENSIBLES = {
    "facture": {
        "total_ttc", "subtotal_ht", "vat_amount", "currency", "issue_date",
        "issuer_name", "paid", "due_date", "payment_terms_days",
    },
    "virement": {
        "amount", "currency", "direction", "execution_date",
        "sender_name", "beneficiary_name", "motif",
    },
    "contrat": {
        "contract_type", "amount", "currency", "start_date", "end_date",
        "is_open_ended", "duration_months", "notice_period_days", "renewal",
    },
    "cadeau": {
        "valeur_ttc", "devise", "date_reception", "marque", "description",
        "contrepartie",
    },
}

# Champs de la clé de déduplication, recopiés à la racine du document pour
# l'index UNIQUE : une correction doit les y répercuter, sinon l'unicité et la
# recherche de doublon portent sur des valeurs périmées.
_MIROIRS_RACINE = {
    "facture": ("invoice_number", "issuer_tax_id", "total_ttc", "issue_date"),
    "virement": ("transfer_reference", "amount", "execution_date"),
    "contrat": ("reference", "contract_type", "signature_date", "amount"),
    "cadeau": ("marque", "description", "date_reception", "valeur_ttc"),
}

_BLOCS = {
    "facture": "invoice", "virement": "transfer",
    "contrat": "contract", "cadeau": "cadeau",
}
_MODELES = {
    "facture": Invoice, "virement": BankTransfer,
    "contrat": Contract, "cadeau": Cadeau,
}


class DocumentIntrouvable(Exception):
    """Le document visé n'existe pas pour cet utilisateur."""


def champs_editables(document_type: str) -> List[str]:
    """Champs qu'un utilisateur peut corriger à la main, pour un type donné."""
    modele = _MODELES.get(document_type)
    if modele is None:
        return []
    return [f for f in modele.model_fields if f not in _NON_EDITABLES]


def _type_du_document(doc: Dict[str, Any]) -> str:
    dtype = doc.get("document_type")
    if dtype in _BLOCS:
        return dtype
    # Les factures d'avant l'introduction du champ n'en portent pas.
    if "transfer" in doc:
        return "virement"
    if "contract" in doc:
        return "contrat"
    if "cadeau" in doc:
        return "cadeau"
    return "facture"


def _recalculer(deps: Deps, dtype: str, modele: Any) -> Dict[str, Any]:
    """Rejoue les calculs déterministes après correction : contrôles et devise."""
    # Un cadeau ne porte pas les mêmes noms de champs que les pièces comptables
    # (`valeur_ttc`/`devise`/`valeur_eur` au lieu de `amount`/`currency`/`amount_eur`)
    # et n'a aucun contrôle de cohérence à rejouer : il n'y a pas de document à
    # recouper, seulement une valeur que l'utilisateur assume.
    if dtype == "cadeau":
        modele.valeur_eur, modele.exchange_rate, modele.rate_source = fx.enrich_amount_eur(
            deps.db, modele.valeur_ttc, modele.devise, modele.date_reception
        )
        modele.rate_date = modele.date_reception if modele.valeur_eur is not None else None
        # La valeur retenue s'écarte-t-elle de ce que la machine avait proposé ?
        if modele.valeur_estimee is not None and modele.valeur_ttc is not None:
            modele.valeur_corrigee = abs(modele.valeur_ttc - modele.valeur_estimee) > 0.01
        return {"incoherences": []}

    if dtype == "virement":
        incoherences = compute_virement_incoherences(modele)
        date_taux = modele.execution_date
    elif dtype == "contrat":
        incoherences = compute_contrat_incoherences(modele)
        date_taux = modele.signature_date or modele.start_date
    else:
        incoherences = compute_incoherences(modele)
        date_taux = modele.issue_date

    montant = modele.total_ttc if dtype == "facture" else modele.amount
    modele.amount_eur, modele.exchange_rate, modele.rate_source = fx.enrich_amount_eur(
        deps.db, montant, modele.currency, date_taux
    )
    modele.rate_date = date_taux if modele.amount_eur is not None else None
    return {"incoherences": incoherences}


def _resynthetiser(deps: Deps, dtype: str, doc: Dict[str, Any], modele: Any,
                   incoherences: List[str]) -> Optional[str]:
    """Rejoue la synthèse rédigée. `None` si le modèle est indisponible.

    Jamais bloquant : une correction de champ est une donnée acquise, elle ne
    doit pas être perdue parce que le fournisseur LLM est momentanément muet.
    """
    ocr = doc.get("ocr_text") or ""
    mode = doc.get("writing_mode")
    doutes = doc.get("uncertain_fields") or []
    try:
        if dtype == "virement":
            system, user = prompts.write_virement_analysis(
                ocr, modele.model_dump(), incoherences, writing_mode=mode, confirmed=doutes
            )
        elif dtype == "contrat":
            system, user = prompts.write_contrat_analysis(
                ocr, modele.model_dump(), incoherences, writing_mode=mode, confirmed=doutes
            )
        else:
            paiement = compute_payment(modele)
            system, user = prompts.write_analysis(
                ocr, modele.model_dump(), payment_note=paiement.get("note"),
                incoherences=incoherences, writing_mode=mode, confirmed=doutes,
            )
        return deps.mistral.chat_text(MODEL_LARGE, system, user)
    except Exception as exc:  # noqa: BLE001 - la correction prime sur la synthèse
        logger.warning("Synthèse non régénérée (document %s) : %s", doc.get("document_id"), exc)
        return None


def update_document_fields(
    deps: Deps, user_id: str, document_id: str, updates: Dict[str, Any]
) -> Dict[str, Any]:
    """Applique des corrections humaines sur les champs extraits d'une pièce.

    L'humain fait autorité : la valeur saisie remplace celle du modèle, sans
    discussion. Les conséquences déterministes (contrôles de cohérence,
    conversion en euros, échéance) sont recalculées ; la synthèse rédigée n'est
    rejouée que si un champ porteur de sens a bougé.

    Renvoie le document mis à jour, augmenté de `resynthese` : True si la
    synthèse a été rejouée, False si elle aurait dû l'être mais a échoué,
    None si le changement ne le justifiait pas.
    """
    doc = deps.db.get_document_by_id(user_id, document_id)
    if not doc:
        raise DocumentIntrouvable(document_id)

    dtype = _type_du_document(doc)
    bloc, modele_cls = _BLOCS[dtype], _MODELES[dtype]
    autorises = set(champs_editables(dtype))

    valeurs = dict(doc.get(bloc) or {})
    corriges: List[str] = []
    for champ, brut in (updates or {}).items():
        if champ not in autorises:
            continue
        valeurs[champ] = _coerce_field(champ, "" if brut is None else str(brut))
        corriges.append(champ)

    if not corriges:
        return {**doc, "resynthese": None, "corrected_now": []}

    modele = modele_cls.model_validate(valeurs)
    calculs = _recalculer(deps, dtype, modele)

    sensible = bool(set(corriges) & _CHAMPS_SENSIBLES[dtype])
    analyse = _resynthetiser(deps, dtype, doc, modele, calculs["incoherences"]) if sensible else None

    a_jour: Dict[str, Any] = {
        bloc: modele.model_dump(),
        "incoherences": calculs["incoherences"],
        # Trace des corrections humaines, cumulée : une valeur validée à la
        # main n'a pas le même statut qu'une valeur lue par la machine.
        "corrected_fields": sorted(set(doc.get("corrected_fields") or []) | set(corriges)),
    }
    for champ in _MIROIRS_RACINE[dtype]:
        a_jour[champ] = getattr(modele, champ, None)
    if dtype == "facture":
        paiement = compute_payment(modele)
        a_jour["paid"] = paiement.get("paid")
        a_jour["payment_date"] = paiement.get("payment_date")
        a_jour["payment_note"] = paiement.get("note")
    if analyse:
        a_jour["analysis"] = analyse

    collection = {"facture": deps.db.invoices, "virement": deps.db.virements,
                  "contrat": deps.db.contrats}[dtype]
    collection.update_one({"user_id": user_id, "document_id": document_id}, {"$set": a_jour})

    if analyse:
        # La discussion s'ouvre sur la synthèse : sans ce rappel, elle
        # continuerait d'exposer une analyse démentie par la correction.
        deps.db.append_messages(
            user_id, document_id,
            [{"role": "assistant", "content": analyse}],
        )

    fusionne = {**doc, **a_jour}
    fusionne["resynthese"] = (analyse is not None) if sensible else None
    fusionne["corrected_now"] = corriges
    return fusionne


# ---------------------------------------------------------------------------
# Point d'entrée Q&A séparé (ancré sur OCR stocké + historique, SANS RAG)
# ---------------------------------------------------------------------------
def answer_question(deps: Deps, user_id: str, document_id: str, question: str) -> str:
    # Cherche dans les quatre collections : facture, virement, contrat OU cadeau.
    doc = deps.db.get_document_by_id(user_id, document_id)
    if not doc:
        raise ValueError("Document introuvable pour cette session.")
    history = deps.db.get_history(user_id, document_id)
    dtype = _type_du_document(doc)
    # Le bloc métier est choisi par le TYPE, et non par un enchaînement de `or` : un
    # cadeau n'a ni `invoice` ni `transfer` ni `contract`, et retombait donc sur un
    # dictionnaire vide — le modèle répondait « aucune information » alors que tous
    # les champs étaient renseignés.
    structured = doc.get(_BLOCS.get(dtype, "invoice")) or {}
    system, user = prompts.qa_answer(
        doc.get("ocr_text", "") or "",
        structured,
        history,
        question,
        document_type=dtype,
        analysis=doc.get("analysis"),
    )
    answer = deps.mistral.chat_text(MODEL_LARGE, system, user)
    deps.db.append_messages(
        user_id,
        document_id,
        [{"role": "user", "content": question}, {"role": "assistant", "content": answer}],
    )
    return answer
