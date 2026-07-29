// Real HTTP API client for the FastAPI backend.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

const SESSION_ID_KEY = "ledgermind_session_id";

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) {
    clearAuth();
  }
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  const detail = err?.detail;
  if (typeof detail === "string") return detail;
  return `HTTP ${response.status}`;
}

export function getStoredSessionId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return (
      sessionStorage.getItem(SESSION_ID_KEY) ||
      localStorage.getItem(SESSION_ID_KEY)
    );
  } catch {
    return null;
  }
}

export function storeSessionId(id: string): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(SESSION_ID_KEY, id);
    sessionStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // ignore quota / private-mode failures
  }
}

// -------- Orchestrator --------

export type Mismatch = {
  field: string;
  declared_value: string | null;
  actual_value: string | null;
  note: string;
};

export type ComplianceAlert = {
  severity: "info" | "warning" | "critical";
  message: string;
};

export type RecommendedAction = {
  step: number;
  title: string;
  description: string;
};

export type UserProfile = {
  siret: string | null;
  siren: string | null;
  denomination: string | null;
  legal_form: string | null;
  nature_juridique_code: string | null;
  is_entrepreneur_individuel: boolean | null;
  micro_eligible: boolean | null;
  registry_address: string | null;
  ape_code: string | null;
  activity_declared: string | null;
  creation_date: string | null;
  administrative_status: string | null;
  verification_status: "verified" | "not_verified" | "skipped" | null;
  registry_document_required: boolean | null;
  registry_document_uploaded: boolean;
  registry_document_type: "kbis" | "rne_extract" | null;
  kbis_obtained: boolean | null;
  rcs_registered: boolean | null;
  registry_tax_base: "BIC" | "BNC" | null;
  sirene_document_uploaded: boolean;
  sirene_document_activity_label: string | null;
  sirene_document_address: string | null;
  sirene_document_registration_date: string | null;
  activity_types: string[];
  has_secondary_activity: boolean | null;
  secondary_activity_types: string[];
  main_activity_commercial: boolean | null;
  revenue_sources: string[];
  currencies: string[];
  estimated_monthly_revenue: string | null;
  estimated_annual_revenue: string | null;
  revenue_variability: "stable" | "spiky" | "unknown" | null;
  invoices_already_issued: boolean | null;
  first_income_date: string | null;
  has_recurring_contracts: boolean | null;
  in_kind_gifts: boolean | null;
  international_clients: boolean | null;
  tax_category: "BNC" | "BIC" | "mixed" | null;
  tax_category_reason: string | null;
  recommended_regime: string | null;
  regime_plafond: string | null;
  fiscal_classification_status: "confirmed" | "inconsistent" | "requires_expert" | null;
  fiscal_inconsistency_reason: string | null;
  activity_mismatch: boolean;
  mismatches: Mismatch[];
  compliance_alerts: ComplianceAlert[];
  recommended_actions: RecommendedAction[];
};

export type DiagnosticProfile = {
  activite: string | null;
  ca_estime_annuel: number | null;
  vend_produits: boolean | null;
  recoit_cadeaux: boolean | null;
  type_activite: string | null;
  premiere_annee: boolean | null;
  jours_activite: number | null;
  anciennete: string | null;
  ca_n_1_au_dessus_seuil: boolean | null;
  ca_n_2_au_dessus_seuil: boolean | null;
  situation_actuelle: string | null;
  ca_prestations: number | null;
  ca_vente: number | null;
  choix_parcours: string | null;
};

export type OrchestratorTurnResponse = {
  session_id: string;
  phase: string;
  ui_action:
    | "show_verification_result"
    | "ask_question"
    | "upload_registry_document"
    | "upload_sirene_document"
    | "show_tax_result"
    | "show_compliance"
    | "show_roadmap"
    | "done"
    | "requires_expert";
  message: string | null;
  quick_replies: string[];
  profile: UserProfile;
  profile_completeness?: number;
  roadmap?: Record<string, unknown> | null;
  diagnostic_profile?: DiagnosticProfile | null;
};

export type StartOrchestratorOptions = {
  siret?: string | null;
  skip_verification?: boolean;
  branch?: "intake" | "guidance";
  company_name?: string | null;
};

export async function startOrchestrator(
  siretOrOptions?: string | StartOrchestratorOptions,
): Promise<OrchestratorTurnResponse> {
  const opts: StartOrchestratorOptions =
    typeof siretOrOptions === "string" || siretOrOptions === undefined
      ? { siret: siretOrOptions ?? null }
      : siretOrOptions;

  const response = await fetch(`${API_BASE}/api/orchestrator/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      siret: opts.siret ? opts.siret.replace(/\s/g, "") : null,
      company_name: opts.company_name ?? null,
      skip_verification: opts.skip_verification ?? false,
      branch: opts.branch ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data: OrchestratorTurnResponse = await response.json();
  storeSessionId(data.session_id);
  return data;
}

export type SessionDetail = {
  session_id: string;
  phase: string;
  branch: string;
  profile: UserProfile;
  diagnostic_profile: DiagnosticProfile | null;
  roadmap: Record<string, unknown> | null;
};

const DIAGNOSTIC_RESULT_KEY = "ledgermind_diagnostic_result";

export function cacheDiagnosticResult(detail: SessionDetail): void {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(DIAGNOSTIC_RESULT_KEY, JSON.stringify(detail));
    storeSessionId(detail.session_id);
  } catch {
    /* ignore */
  }
}

export function loadCachedDiagnosticResult(): SessionDetail | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(DIAGNOSTIC_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionDetail;
  } catch {
    return null;
  }
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(`${API_BASE}/api/orchestrator/session/${sessionId}/detail`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function orchestratorTurn(
  sessionId: string,
  userAnswer?: string,
): Promise<OrchestratorTurnResponse> {
  const response = await fetch(`${API_BASE}/api/orchestrator/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ session_id: sessionId, user_answer: userAnswer ?? null }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function fetchMySessions(): Promise<
  { session_id: string; branch: string | null; phase: string | null; updated_at: string }[]
> {
  const response = await fetch(`${API_BASE}/api/orchestrator/my-sessions`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function fetchUserProfile(sessionId: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/api/orchestrator/session/${sessionId}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

// -------- Verification uploads --------

export type RegistryDocUploadResult = {
  ok: boolean;
  document_type: "kbis" | "rne_extract";
  rcs_registered: boolean;
  registry_tax_base: "BIC" | "BNC";
  siren: string | null;
  confidence: string;
};

export async function uploadRegistryDocument(
  sessionId: string,
  file: File,
): Promise<RegistryDocUploadResult> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("file", file);

  const response = await fetch(`${API_BASE}/api/verification/registry-document`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(err.detail ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export type SireneAvisUploadResult = {
  ok: boolean;
  activity_label: string | null;
  address: string | null;
  registration_date: string | null;
  siren: string | null;
};

export async function uploadSireneAvis(
  sessionId: string,
  file: File,
): Promise<SireneAvisUploadResult> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("file", file);

  const response = await fetch(`${API_BASE}/api/verification/sirene-avis`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(err.detail ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export async function ocrExtractSiret(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}/api/verification/ocr-siret`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Erreur inconnue." }));
    throw new Error(err.detail ?? `Erreur ${response.status}`);
  }

  const data = await response.json();
  return data.siret as string;
}

export function formatMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
