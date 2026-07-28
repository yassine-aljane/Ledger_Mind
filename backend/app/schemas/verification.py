from pydantic import BaseModel
from typing import Literal


class OcrResult(BaseModel):
    siret: str


class VerificationRequest(BaseModel):
    siret: str
    company_name: str | None = None
    email: str | None = None


class Mismatch(BaseModel):
    field: str
    sirene_value: str | None = None
    rne_value: str | None = None
    note: str


class VerificationResult(BaseModel):
    status: Literal["verified", "not_verified"]
    siret: str
    denomination: str | None = None
    legal_form: str | None = None
    nature_juridique_code: str | None = None
    is_entrepreneur_individuel: bool | None = None
    micro_eligible: bool | None = None
    registry_address: str | None = None
    ape_code: str | None = None
    activity_declared: str | None = None
    creation_date: str | None = None
    administrative_status: str | None = None
    registry_document_required: bool | None = None
    registry_document_type: Literal["kbis", "rne_extract"] | None = None
    rcs_registered: bool | None = None
    registry_tax_base: Literal["BIC", "BNC"] | None = None
    registry_tax_reason: str | None = None
    mismatches: list[Mismatch] = []
    explanation: str
    next_action: str | None = None


class RegistryDocUploadResult(BaseModel):
    ok: bool
    document_type: Literal["kbis", "rne_extract"]
    rcs_registered: bool
    registry_tax_base: Literal["BIC", "BNC"]
    siren: str | None = None
    confidence: str


class SireneAvisUploadResult(BaseModel):
    ok: bool
    activity_label: str | None = None
    address: str | None = None
    registration_date: str | None = None
    siren: str | None = None
