"""API router for the capture agent (invoice / transfer document analysis)."""

from __future__ import annotations

import asyncio
import base64
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.agents.capture.app import fx, nodes
from app.agents.capture.app.cadeau import estimer_cadeau
from app.agents.capture.app.db import DuplicateCadeauError
from app.agents.capture.app.schemas import (
    AnalyzeResponse,
    AnswerResponse,
    BankTransfer,
    Cadeau,
    CadeauListItem,
    Contract,
    ContratListItem,
    DocumentDetail,
    EstimationCadeau,
    Invoice,
    InvoiceListItem,
    PendingQuestion,
    QAResponse,
    Status,
    VirementListItem,
)
from app.api.deps import get_current_user
from app.core.users import users_collection
from app.schemas.auth import UserPublic
from app.services.capture_runtime import get_runtime, resume_graph, run_graph

router = APIRouter(prefix="/api/capture", tags=["capture"])


class CaptureAnswerBody(BaseModel):
    thread_id: str
    answer: str = Field(min_length=1)


class CaptureQABody(BaseModel):
    document_id: str
    question: str = Field(min_length=1)


class DocumentMessage(BaseModel):
    role: str
    content: str


def _interrupts(graph, config) -> tuple[Any, list[Any]]:
    snap = graph.get_state(config)
    ints = [i for t in snap.tasks for i in (getattr(t, "interrupts", None) or [])]
    return snap, ints


def _build_analyze_response(graph, config, thread_id: str) -> AnalyzeResponse:
    snap, ints = _interrupts(graph, config)
    values: dict[str, Any] = snap.values or {}
    document_id = values.get("document_id")

    if ints:
        payload = ints[0].value or {}
        pending = PendingQuestion(
            type=payload.get("type"),
            question=payload.get("question", ""),
            field=payload.get("field"),
            suggestions=payload.get("suggestions"),
            existing_invoice=payload.get("existing_invoice"),
            new_invoice=payload.get("new_invoice"),
        )
        return AnalyzeResponse(
            status=Status.en_attente_utilisateur,
            thread_id=thread_id,
            document_id=document_id,
            pending=pending,
        )

    if values.get("document_type") == "autre":
        return AnalyzeResponse(
            status=Status.non_pris_en_charge,
            thread_id=thread_id,
            document_id=document_id,
            document_type="autre",
            detected_nature=values.get("detected_nature"),
            message=values.get("message"),
            saved=False,
        )

    if values.get("document_type") == "virement":
        return AnalyzeResponse(
            status=Status.completed,
            thread_id=thread_id,
            document_id=document_id,
            document_type="virement",
            transfer=BankTransfer(**(values.get("virement") or {})),
            analysis=values.get("analysis"),
            incoherences=values.get("incoherences"),
            saved=values.get("saved"),
            duplicate_skipped=values.get("duplicate_skipped"),
        )

    if values.get("document_type") == "contrat":
        return AnalyzeResponse(
            status=Status.completed,
            thread_id=thread_id,
            document_id=document_id,
            document_type="contrat",
            contract=Contract(**(values.get("contrat") or {})),
            analysis=values.get("analysis"),
            incoherences=values.get("incoherences"),
            saved=values.get("saved"),
            duplicate_skipped=values.get("duplicate_skipped"),
        )

    payment: dict[str, Any] = values.get("payment") or {}
    return AnalyzeResponse(
        status=Status.completed,
        thread_id=thread_id,
        document_id=document_id,
        document_type="facture",
        invoice=Invoice(**(values.get("invoice") or {})),
        analysis=values.get("analysis"),
        expense_category=values.get("expense_category"),
        incoherences=values.get("incoherences"),
        paid=payment.get("paid"),
        payment_date=payment.get("payment_date"),
        payment_days_until=nodes.days_until(payment.get("payment_date")),
        saved=values.get("saved"),
        duplicate_skipped=values.get("duplicate_skipped"),
    )


def _sync_user_capture_context(user_id: str, resp: AnalyzeResponse) -> None:
    # Un document hors périmètre n'est pas enregistré : l'inscrire au fil
    # d'activité y ferait apparaître une pièce qui n'existe nulle part.
    if resp.status == Status.non_pris_en_charge:
        return
    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "thread_id": resp.thread_id,
        "document_id": resp.document_id,
        "status": resp.status.value if hasattr(resp.status, "value") else str(resp.status),
        "document_type": resp.document_type,
        "expense_category": resp.expense_category,
        "invoice_number": (resp.invoice.invoice_number if resp.invoice else None),
        "total_ttc": (resp.invoice.total_ttc if resp.invoice else None),
        "contract_type": (resp.contract.contract_type if resp.contract else None),
        "created_at": now,
    }
    users_collection().update_one(
        {"id": user_id},
        {
            "$set": {
                "agent_context.capture.last_thread_id": resp.thread_id,
                "agent_context.capture.last_document_id": resp.document_id,
                "agent_context.capture.updated_at": now,
            },
            "$push": {"agent_context.capture.history": entry},
        },
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_document(
    file: UploadFile = File(...),
    activite: str | None = None,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    graph = runtime["graph"]
    thread_id = uuid.uuid4().hex
    config = {"configurable": {"thread_id": thread_id}}

    try:
        data = await file.read()
        if not data:
            return AnalyzeResponse(
                status=Status.erreur,
                thread_id=thread_id,
                error="Fichier vide ou illisible.",
            )

        initial: dict[str, Any] = {
            "user_id": user.id,
            "document_id": uuid.uuid4().hex,
            "filename": file.filename,
            "mime": file.content_type,
            "file_b64": base64.b64encode(data).decode("ascii"),
            "messages": [],
        }
        if activite:
            initial["activite"] = activite

        await run_graph(graph, initial, config)
        resp = _build_analyze_response(graph, config, thread_id)
        await asyncio.to_thread(_sync_user_capture_context, user.id, resp)
        return resp
    except Exception as exc:
        return AnalyzeResponse(status=Status.erreur, thread_id=thread_id, error=str(exc))


@router.post("/answer", response_model=AnswerResponse)
async def answer_document(
    body: CaptureAnswerBody,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    graph = runtime["graph"]
    deps = runtime["deps"]
    config = {"configurable": {"thread_id": body.thread_id}}

    try:
        snap, ints = _interrupts(graph, config)
        values: dict[str, Any] = snap.values or {}

        if values.get("user_id") and values.get("user_id") != user.id:
            raise HTTPException(status_code=403, detail="Ce document ne vous appartient pas.")

        if ints:
            await resume_graph(graph, body.answer, config)
            analyze_resp = _build_analyze_response(graph, config, body.thread_id)
            await asyncio.to_thread(_sync_user_capture_context, user.id, analyze_resp)
            return AnswerResponse(
                status=analyze_resp.status,
                thread_id=body.thread_id,
                document_id=analyze_resp.document_id,
                analyze=analyze_resp,
            )

        user_id = values.get("user_id")
        document_id = values.get("document_id")
        if not user_id or not document_id:
            return AnswerResponse(
                status=Status.erreur,
                thread_id=body.thread_id,
                error="Thread inconnu ou sans document associé.",
            )

        ans = await asyncio.to_thread(
            nodes.answer_question, deps, user_id, document_id, body.answer
        )
        return AnswerResponse(
            status=Status.completed,
            thread_id=body.thread_id,
            document_id=document_id,
            answer=ans,
        )
    except HTTPException:
        raise
    except Exception as exc:
        return AnswerResponse(status=Status.erreur, thread_id=body.thread_id, error=str(exc))


@router.post("/qa", response_model=QAResponse)
async def qa_document(
    body: CaptureQABody,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    deps = runtime["deps"]
    try:
        ans = await asyncio.to_thread(
            nodes.answer_question, deps, user.id, body.document_id, body.question
        )
        return QAResponse(status=Status.completed, document_id=body.document_id, answer=ans)
    except Exception as exc:
        return QAResponse(status=Status.erreur, document_id=body.document_id, error=str(exc))


@router.get("/invoices", response_model=list[InvoiceListItem])
async def list_invoices(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_invoices, user.id)
    out: list[InvoiceListItem] = []
    for d in docs:
        out.append(
            InvoiceListItem(
                document_id=d.get("document_id", ""),
                invoice=Invoice(**(d.get("invoice") or {})),
                analysis=d.get("analysis"),
                expense_category=d.get("expense_category"),
                incoherences=d.get("incoherences"),
                paid=d.get("paid"),
                payment_date=d.get("payment_date"),
                payment_days_until=nodes.days_until(d.get("payment_date")),
                created_at=d.get("created_at"),
                filename=d.get("filename"),
                has_file=bool(d.get("has_file")),
            )
        )
    return out


def _build_document_detail(d: dict[str, Any], document_id: str) -> DocumentDetail:
    """Met un document stocké à la forme de la fiche exposée par l'API."""
    # Virements et contrats portent `document_type`; les factures d'avant ce
    # champ n'en ont pas — la présence de leur bloc métier fait alors foi.
    dtype = d.get("document_type")
    if dtype not in ("facture", "virement", "contrat", "cadeau"):
        dtype = (
            "virement" if "transfer" in d
            else "contrat" if "contract" in d
            else "cadeau" if "cadeau" in d
            else "facture"
        )
    common = {
        "document_id": d.get("document_id", document_id),
        "filename": d.get("filename"),
        "mime": d.get("mime"),
        "has_file": bool(d.get("has_file")),
        "created_at": d.get("created_at"),
        "analysis": d.get("analysis"),
        "incoherences": d.get("incoherences"),
        "ocr_text": d.get("ocr_text"),
        "detected_language": d.get("detected_language"),
        "writing_mode": d.get("writing_mode"),
        "uncertain_fields": d.get("uncertain_fields"),
        "corrected_fields": d.get("corrected_fields"),
        "editable_fields": nodes.champs_editables(dtype),
    }
    if dtype == "virement":
        return DocumentDetail(
            document_type="virement",
            transfer=BankTransfer(**(d.get("transfer") or {})),
            **common,
        )
    if dtype == "contrat":
        return DocumentDetail(
            document_type="contrat",
            contract=Contract(**(d.get("contract") or {})),
            **common,
        )
    if dtype == "cadeau":
        return DocumentDetail(
            document_type="cadeau",
            cadeau=Cadeau(**(d.get("cadeau") or {})),
            **common,
        )
    return DocumentDetail(
        document_type="facture",
        invoice=Invoice(**(d.get("invoice") or {})),
        expense_category=d.get("expense_category"),
        paid=d.get("paid"),
        payment_date=d.get("payment_date"),
        payment_days_until=nodes.days_until(d.get("payment_date")),
        **common,
    )


@router.get("/documents/{document_id}", response_model=DocumentDetail)
async def document_detail(document_id: str, user: UserPublic = Depends(get_current_user)):
    """Vue complète d'un document déjà traité (facture, virement ou contrat)."""
    runtime = get_runtime()
    deps = runtime["deps"]
    d = await asyncio.to_thread(deps.db.get_document_by_id, user.id, document_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    return _build_document_detail(d, document_id)


class CaptureUpdateBody(BaseModel):
    """Corrections humaines : un champ métier -> sa nouvelle valeur (texte brut)."""

    updates: dict[str, Any] = Field(min_length=1)


class CaptureUpdateResponse(BaseModel):
    document: DocumentDetail
    corrected: list[str]
    # True si la synthèse a été rejouée, False si elle aurait dû l'être mais a
    # échoué, None si la correction ne le justifiait pas.
    resynthese: bool | None = None


@router.patch("/documents/{document_id}", response_model=CaptureUpdateResponse)
async def update_document(
    document_id: str,
    body: CaptureUpdateBody,
    user: UserPublic = Depends(get_current_user),
):
    """Corrige des champs extraits. L'utilisateur fait autorité sur la machine."""
    runtime = get_runtime()
    deps = runtime["deps"]
    try:
        doc = await asyncio.to_thread(
            nodes.update_document_fields, deps, user.id, document_id, body.updates
        )
    except nodes.DocumentIntrouvable:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    except DuplicateKeyError:
        # La correction rendrait cette pièce identique à une autre déjà
        # enregistrée : l'index de déduplication s'y oppose.
        raise HTTPException(
            status_code=409,
            detail=(
                "Cette correction rendrait le document identique à une pièce déjà "
                "enregistrée. Vérifiez qu'il ne s'agit pas d'un doublon."
            ),
        )

    return CaptureUpdateResponse(
        document=_build_document_detail(doc, document_id),
        corrected=doc.get("corrected_now") or [],
        resynthese=doc.get("resynthese"),
    )


def _forget_capture_history(user_id: str, document_id: str) -> None:
    """Retire la pièce du fil d'activité de l'utilisateur.

    `agent_context.capture` conserve une entrée par analyse : la laisser après
    suppression ferait réapparaître un document qui n'existe plus.
    """
    users = users_collection()
    users.update_one(
        {"id": user_id},
        {"$pull": {"agent_context.capture.history": {"document_id": document_id}}},
    )
    # Le dernier document consulté ne doit pas pointer sur une pièce effacée.
    users.update_one(
        {"id": user_id, "agent_context.capture.last_document_id": document_id},
        {
            "$set": {
                "agent_context.capture.last_document_id": None,
                "agent_context.capture.last_thread_id": None,
            }
        },
    )


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, user: UserPublic = Depends(get_current_user)):
    """Supprime définitivement une pièce et tout ce qui s'y rattache."""
    runtime = get_runtime()
    deps = runtime["deps"]
    removed = await asyncio.to_thread(deps.db.delete_document, user.id, document_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    await asyncio.to_thread(_forget_capture_history, user.id, document_id)
    return Response(status_code=204)


# Types rendus tels quels dans le navigateur. Tout le reste est renvoyé en
# téléchargement neutre : servir un dépôt utilisateur `inline` avec son type
# déclaré laisserait un .html ou .svg s'exécuter sur l'origine de l'API.
_INLINE_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}

_EXT_MIMES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _serve_mime(mime: str | None, filename: str | None) -> str | None:
    """Type MIME sûr pour l'affichage, `None` si le document doit être téléchargé."""
    candidate = (mime or "").split(";")[0].strip().lower()
    if candidate not in _INLINE_MIMES and filename:
        suffix = Path(filename).suffix.lower()
        candidate = _EXT_MIMES.get(suffix, candidate)
    return candidate if candidate in _INLINE_MIMES else None


@router.get("/documents/{document_id}/file")
async def document_file(document_id: str, user: UserPublic = Depends(get_current_user)):
    """Renvoie la pièce d'origine (PDF/image) pour affichage."""
    runtime = get_runtime()
    deps = runtime["deps"]
    found = await asyncio.to_thread(deps.db.get_original_file, user.id, document_id)
    if not found:
        raise HTTPException(
            status_code=404,
            detail="Pièce d'origine non conservée pour ce document.",
        )
    data, filename, mime = found
    safe_mime = _serve_mime(mime, filename)
    disposition = "inline" if safe_mime else "attachment"
    name = Path(filename or document_id).name.replace('"', "")
    return Response(
        content=data,
        media_type=safe_mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'{disposition}; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/documents/{document_id}/messages", response_model=list[DocumentMessage])
async def document_messages(document_id: str, user: UserPublic = Depends(get_current_user)):
    """Historique de conversation (chat par document), filtré par utilisateur."""
    runtime = get_runtime()
    deps = runtime["deps"]
    history = await asyncio.to_thread(deps.db.get_history, user.id, document_id)
    return [DocumentMessage(role=m.get("role", ""), content=m.get("content", "")) for m in history]


@router.get("/virements", response_model=list[VirementListItem])
async def list_virements(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_virements, user.id)
    return [
        VirementListItem(
            document_id=d.get("document_id", ""),
            transfer=BankTransfer(**(d.get("transfer") or {})),
            analysis=d.get("analysis"),
            incoherences=d.get("incoherences"),
            created_at=d.get("created_at"),
            filename=d.get("filename"),
            has_file=bool(d.get("has_file")),
        )
        for d in docs
    ]


@router.get("/contrats", response_model=list[ContratListItem])
async def list_contrats(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_contrats, user.id)
    return [
        ContratListItem(
            document_id=d.get("document_id", ""),
            contract=Contract(**(d.get("contract") or {})),
            analysis=d.get("analysis"),
            incoherences=d.get("incoherences"),
            created_at=d.get("created_at"),
            filename=d.get("filename"),
            has_file=bool(d.get("has_file")),
        )
        for d in docs
    ]


# ------------------------------------------------------- Cadeaux en nature (gifting)

# Une photo de cadeau est toujours une image : accepter un PDF n'aurait aucun sens
# pour de la reconnaissance d'objet, et le refuser tôt évite un appel modèle inutile.
_IMAGES_ACCEPTEES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _valider_photo(file: UploadFile, data: bytes) -> None:
    if not data:
        raise HTTPException(status_code=400, detail="Fichier vide ou illisible.")
    mime = (file.content_type or "").lower()
    if mime and not mime.startswith("image/"):
        raise HTTPException(
            status_code=415,
            detail="La photo d'un cadeau doit être une image (JPEG, PNG ou WebP).",
        )


@router.post("/cadeau/estimer", response_model=EstimationCadeau)
async def estimer_cadeau_endpoint(
    file: UploadFile = File(...),
    user: UserPublic = Depends(get_current_user),
):
    """Propose une valeur marchande à partir d'une photo — sans rien enregistrer.

    Volontairement séparé de la déclaration : l'utilisateur doit pouvoir regarder la
    suggestion, la corriger, ou l'ignorer, avant que quoi que ce soit n'entre dans sa
    comptabilité. Estimer n'engage rien ; déclarer engage.
    """
    data = await file.read()
    _valider_photo(file, data)

    runtime = get_runtime()
    deps = runtime["deps"]
    return await asyncio.to_thread(
        estimer_cadeau, deps.mistral, data, file.content_type or "image/jpeg"
    )


class CadeauDeclareResponse(BaseModel):
    document_id: str
    cadeau: Cadeau
    duplicate_skipped: bool = False


@router.post("/cadeau", response_model=CadeauDeclareResponse)
async def declarer_cadeau(
    file: UploadFile | None = File(None),
    description: str = Form(...),
    marque: str | None = Form(None),
    date_reception: str | None = Form(None),
    valeur_ttc: float = Form(...),
    devise: str = Form("EUR"),
    contrepartie: str | None = Form(None),
    # Attestation explicite que la valeur a été relue par un humain. Le client la
    # pose au moment où l'utilisateur valide le formulaire ; sans elle, on refuse.
    valeur_confirmee: bool = Form(False),
    # Suggestion d'origine, renvoyée telle quelle par le client : on la conserve
    # à côté de la valeur retenue pour garder trace de l'arbitrage humain.
    valeur_estimee: float | None = Form(None),
    fourchette_min: float | None = Form(None),
    fourchette_max: float | None = Form(None),
    confiance: str | None = Form(None),
    objet_identifie: str | None = Form(None),
    source_estimation: str | None = Form(None),
    user: UserPublic = Depends(get_current_user),
):
    """Enregistre un cadeau en nature comme une pièce à part entière.

    Human-in-the-loop, et c'est le point central de cet endpoint : le modèle ne
    déclare RIEN. Il propose une valeur via `/cadeau/estimer`, qui n'écrit pas en
    base ; seule cette route-ci enregistre, et elle exige `valeur_ttc` en clair plus
    `valeur_confirmee`. Un client qui se contenterait de réémettre l'estimation sans
    la montrer à l'utilisateur doit donc mentir explicitement — la responsabilité du
    montant déclaré reste humaine, ce qui est exactement ce que demande une
    déclaration fiscale.

    La photo est facultative : un cadeau reste déclarable sans elle, et refuser la
    déclaration faute d'image reviendrait à empêcher l'utilisateur de se mettre en
    règle.
    """
    if not valeur_confirmee:
        raise HTTPException(
            status_code=422,
            detail=(
                "La valeur marchande doit être relue et confirmée avant déclaration : "
                "l'estimation automatique ne vaut pas déclaration."
            ),
        )
    if valeur_ttc <= 0:
        raise HTTPException(
            status_code=400,
            detail="La valeur marchande doit être supérieure à zéro.",
        )

    runtime = get_runtime()
    deps = runtime["deps"]
    document_id = uuid.uuid4().hex

    cadeau = Cadeau(
        description=description.strip(),
        marque=(marque or "").strip() or None,
        date_reception=(date_reception or "").strip() or None,
        valeur_ttc=valeur_ttc,
        devise=(devise or "EUR").strip().upper(),
        valeur_estimee=valeur_estimee,
        fourchette_min=fourchette_min,
        fourchette_max=fourchette_max,
        confiance=(confiance or "").strip() or None,
        objet_identifie=(objet_identifie or "").strip() or None,
        source_estimation=(source_estimation or "").strip() or None,
        contrepartie=(contrepartie or "").strip() or None,
    )
    # Trace de l'arbitrage : la valeur déclarée suit-elle la machine, ou l'humain ?
    if cadeau.valeur_estimee is not None:
        cadeau.valeur_corrigee = abs(cadeau.valeur_ttc - cadeau.valeur_estimee) > 0.01

    # Conversion en euros : la déclaration se fait en euros, quelle que soit la
    # devise du prix public relevé.
    cadeau.valeur_eur, cadeau.exchange_rate, cadeau.rate_source = await asyncio.to_thread(
        fx.enrich_amount_eur, deps.db, cadeau.valeur_ttc, cadeau.devise, cadeau.date_reception
    )
    cadeau.rate_date = cadeau.date_reception if cadeau.valeur_eur is not None else None

    dedup = cadeau.dedup_key()
    existant = await asyncio.to_thread(deps.db.find_duplicate_cadeau, user.id, dedup)
    if existant:
        return CadeauDeclareResponse(
            document_id=existant.get("document_id", ""),
            cadeau=Cadeau(**(existant.get("cadeau") or {})),
            duplicate_skipped=True,
        )

    doc: dict[str, Any] = {
        "user_id": user.id,
        "document_id": document_id,
        "document_type": "cadeau",
        "cadeau": cadeau.model_dump(),
        # Miroirs racine pour l'index unique de déduplication.
        **dedup,
        "analysis": _synthese_cadeau(cadeau),
        "incoherences": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if file is not None:
        data = await file.read()
        if data:
            _valider_photo(file, data)
            saved = await asyncio.to_thread(
                deps.db.save_original_file, user.id, document_id, data,
                file.filename, file.content_type,
            )
            doc["has_file"] = saved
            doc["filename"] = file.filename
            doc["mime"] = file.content_type

    try:
        await asyncio.to_thread(deps.db.insert_cadeau, doc)
    except (DuplicateCadeauError, DuplicateKeyError):
        return CadeauDeclareResponse(
            document_id=document_id, cadeau=cadeau, duplicate_skipped=True
        )

    return CadeauDeclareResponse(document_id=document_id, cadeau=cadeau)


def _synthese_cadeau(c: Cadeau) -> str:
    """Phrase de synthèse affichée sur la fiche, écrite sans appel au modèle.

    Les faits sont déjà tous connus à ce stade — les inventer via un LLM coûterait
    un appel et ouvrirait la porte à une reformulation inexacte.
    """
    valeur = f"{c.valeur_ttc:.2f} {c.devise or 'EUR'}" if c.valeur_ttc is not None else "valeur inconnue"
    marque = f" de {c.marque}" if c.marque else ""
    phrase = (
        f"**Avantage en nature** — {c.description or 'cadeau'}{marque}, "
        f"retenu pour {valeur}."
    )
    if c.valeur_corrigee:
        phrase += " Valeur ajustée par vos soins après estimation automatique."
    elif c.valeur_estimee is not None:
        phrase += " Valeur issue de l'estimation automatique, confirmée par vos soins."
    phrase += (
        " À déclarer au livre des recettes comme un encaissement : un partenariat "
        "rémunéré en nature est un revenu imposable."
    )
    return phrase


@router.get("/cadeaux", response_model=list[CadeauListItem])
async def list_cadeaux(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_cadeaux, user.id)
    return [
        CadeauListItem(
            document_id=d.get("document_id", ""),
            cadeau=Cadeau(**(d.get("cadeau") or {})),
            analysis=d.get("analysis"),
            incoherences=d.get("incoherences"),
            created_at=d.get("created_at"),
            filename=d.get("filename"),
            has_file=bool(d.get("has_file")),
        )
        for d in docs
    ]
