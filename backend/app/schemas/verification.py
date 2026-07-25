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
    ape_code: str | None = None
    activity_declared: str | None = None
    creation_date: str | None = None
    administrative_status: str | None = None  # "actif" / "inactif"
    mismatches: list[Mismatch] = []
    explanation: str
    next_action: str | None = None