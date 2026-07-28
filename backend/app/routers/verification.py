from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.session_store import async_get_session, async_save_session
from app.schemas.verification import (
    OcrResult,
    RegistryDocUploadResult,
    SireneAvisUploadResult,
    VerificationRequest,
    VerificationResult,
)
from app.agents.intake.tools.verification import run_verification_agent
from app.agents.intake.agent import apply_registry_document, apply_sirene_document
from app.services.ocr_siret import SiretNotFoundError, extract_siret_from_bytes
from app.services.ocr_sirene_avis import extract_sirene_avis_from_bytes
from app.services.ocr_registry_doc import classify_registry_document_with_llm

router = APIRouter(prefix="/api/verification", tags=["verification"])


@router.post("/siret", response_model=VerificationResult)
async def verify_siret(payload: VerificationRequest):
    try:
        return await run_verification_agent(payload.siret, payload.company_name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/ocr-siret", response_model=OcrResult)
async def ocr_extract_siret(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 20 Mo).")

    try:
        siret = extract_siret_from_bytes(
            data=data,
            filename=file.filename or "upload",
            mime=file.content_type or "",
        )
        return OcrResult(siret=siret)
    except SiretNotFoundError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'extraction : {e}")


@router.post("/registry-document", response_model=RegistryDocUploadResult)
async def upload_registry_document(
    session_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Step 2 (EI) — OCR Kbis vs extrait RNE, sets BIC/BNC automatically."""
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 20 Mo).")

    try:
        doc = await classify_registry_document_with_llm(
            data=data,
            filename=file.filename or "document.pdf",
            mime=file.content_type or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'analyse : {e}")

    if doc.siren and state.profile.siren and doc.siren != state.profile.siren.replace(" ", ""):
        if doc.confidence == "high":
            raise HTTPException(
                status_code=422,
                detail="Le SIREN du document ne correspond pas à celui vérifié à l'étape 1.",
            )

    state.profile = apply_registry_document(state.profile, doc)
    await async_save_session(session_id, state)

    return RegistryDocUploadResult(
        ok=True,
        document_type=doc.document_type,
        rcs_registered=state.profile.rcs_registered or False,
        registry_tax_base=state.profile.registry_tax_base or "BNC",
        siren=doc.siren,
        confidence=doc.confidence,
    )


@router.post("/sirene-avis", response_model=SireneAvisUploadResult)
async def upload_sirene_avis(
    session_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Step 3 — upload and parse avis de situation SIRENE, archive on session profile."""
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 20 Mo).")

    try:
        doc = extract_sirene_avis_from_bytes(
            data=data,
            filename=file.filename or "avis-sirene.pdf",
            mime=file.content_type or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'extraction : {e}")

    if doc.siren and state.profile.siren and doc.siren != state.profile.siren.replace(" ", ""):
        raise HTTPException(
            status_code=422,
            detail="Le SIREN du document ne correspond pas à celui vérifié à l'étape 1.",
        )

    state.profile = apply_sirene_document(state.profile, doc)
    await async_save_session(session_id, state)

    return SireneAvisUploadResult(
        ok=True,
        activity_label=doc.activity_label,
        address=doc.address,
        registration_date=doc.registration_date,
        siren=doc.siren,
    )
