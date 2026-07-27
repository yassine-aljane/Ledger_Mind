from fastapi import APIRouter, File, HTTPException, UploadFile

from app.schemas.verification import OcrResult, VerificationRequest, VerificationResult
from app.agents.intake.tools.verification import run_verification_agent
from app.services.ocr_siret import SiretNotFoundError, extract_siret_from_bytes

router = APIRouter(prefix="/api/verification", tags=["verification"])


@router.post("/siret", response_model=VerificationResult)
async def verify_siret(payload: VerificationRequest):
    try:
        return await run_verification_agent(payload.siret, payload.company_name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/ocr-siret", response_model=OcrResult)
async def ocr_extract_siret(file: UploadFile = File(...)):
    """Extract a SIRET number from an uploaded PDF or image document."""
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:  # 20 MB hard limit
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
