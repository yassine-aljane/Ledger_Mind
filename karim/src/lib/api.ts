import type {
  AgentContext,
  AuthResponse,
  CaptureAnswerResponse,
  CaptureQaAnswer,
  CaptureResult,
  DiagnosticProfile,
  EducationAnswer,
  EducationConversation,
  EducationConversationSummary,
  EducationMessage,
  InvoiceListItem,
  OcrSiretResult,
  OrchestratorResponse,
  RagStatus,
  ReferralHistoryItem,
  ReferralResult,
  RegistryDocUploadResult,
  Roadmap,
  SessionDetail,
  SessionSummary,
  SireneAvisUploadResult,
  UserPublic,
  VirementListItem,
} from "./types";

export const API_BASE_URL: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  "http://localhost:8000";

const TOKEN_KEY = "ledgermind.token";
const TIER_PREFIX = "ledgermind.subscription_tier";
/** @deprecated legacy global key — cleared on next tier write */
const LEGACY_TIER_KEY = "ledgermind.subscription_tier";

function tierKey(userId: string) {
  return `${TIER_PREFIX}.${userId}`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Static freemium — per user id (not global), until real billing exists. */
export function getStoredTier(userId?: string | null): "free" | "premium" {
  if (typeof window === "undefined" || !userId) return "free";
  const key = tierKey(String(userId));
  const stored = window.localStorage.getItem(key);
  if (stored === "premium" || stored === "free") return stored;
  return "free";
}

export function setStoredTier(userId: string, tier: "free" | "premium") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(tierKey(String(userId)), tier);
  clearLegacyGlobalTier();
}

/** Removes the old browser-wide Premium flag (one key for all accounts). */
export function clearLegacyGlobalTier() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_TIER_KEY);
}

const PENDING_PREMIUM_KEY = "ledgermind.pending_premium";

/** Set when user clicks Premium before signing in — consumed after auth. */
export function setPendingPremium(pending = true) {
  if (typeof window === "undefined") return;
  if (pending) window.sessionStorage.setItem(PENDING_PREMIUM_KEY, "1");
  else window.sessionStorage.removeItem(PENDING_PREMIUM_KEY);
}

export function consumePendingPremium(): boolean {
  if (typeof window === "undefined") return false;
  const pending = window.sessionStorage.getItem(PENDING_PREMIUM_KEY) === "1";
  if (pending) window.sessionStorage.removeItem(PENDING_PREMIUM_KEY);
  return pending;
}

export function resolveSubscriptionTier(
  user: UserPublic | null | undefined,
): "free" | "premium" {
  if (!user) return "free";
  if (getStoredTier(user.id) === "premium") return "premium";
  return user.subscription_tier === "premium" ? "premium" : "free";
}

export function withLocalTier<T extends UserPublic>(user: T): T {
  return { ...user, subscription_tier: resolveSubscriptionTier(user) };
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
  get isPaywall() {
    return this.status === 402 || this.status === 403;
  }
  get isAuth() {
    return this.status === 401;
  }
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(
  path: string,
  options: { method?: string; body?: Body; signal?: AbortSignal; raw?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, signal, raw } = options;
  const headers: Record<string, string> = { Accept: raw ? "*/*" : "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: payload, signal });
  } catch {
    throw new ApiError(0, "Impossible de joindre le serveur LedgerMind. Vérifiez votre connexion.");
  }

  if (raw) {
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, text || `Erreur ${res.status}`);
    }
    return res as unknown as T;
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const detail =
      (data && typeof data === "object" && "detail" in data
        ? typeof (data as { detail: unknown }).detail === "string"
          ? ((data as { detail: string }).detail as string)
          : JSON.stringify((data as { detail: unknown }).detail)
        : null) ?? `Erreur ${res.status}`;
    throw new ApiError(res.status, detail, data);
  }

  return data as T;
}

export const api = {
  /* ---- Auth ---- */
  register: (body: { email: string; password: string; name: string }) =>
    request<AuthResponse>("/api/auth/register", { method: "POST", body }),
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body }),
  me: async () => withLocalTier(await request<UserPublic>("/api/auth/me")),
  context: () => request<AgentContext>("/api/auth/context"),

  /* ---- Abonnement (statique côté client, par utilisateur) ---- */
  upgrade: async (): Promise<UserPublic> => {
    const me = await request<UserPublic>("/api/auth/me");
    setStoredTier(String(me.id), "premium");
    return { ...me, subscription_tier: "premium" };
  },
  /** Pas de Stripe pour l'instant — le front reste utilisable. */
  checkout: async (): Promise<{ url?: string }> => ({}),
  portal: async (): Promise<{ url?: string }> => ({}),

  /* ---- Éducation ---- */
  ragStatus: () => request<RagStatus>("/api/education/rag/status"),
  ask: (body: {
    question: string;
    concerne?: string;
    historique?: EducationMessage[];
    conversation_id?: string | null;
    use_guidance_context?: boolean;
  }) =>
    request<EducationAnswer>("/api/education/ask", {
      method: "POST",
      body: { use_guidance_context: true, ...body },
    }),
  conversations: async () => {
    const data = await request<{ conversations: EducationConversationSummary[] }>(
      "/api/education/conversations",
    );
    return data.conversations ?? [];
  },
  conversation: (id: string) =>
    request<EducationConversation>(`/api/education/conversations/${id}`),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/education/conversations/${id}`, { method: "DELETE" }),
  renameConversation: (id: string, title: string) =>
    request<{ ok: boolean; id: string; title: string }>(`/api/education/conversations/${id}`, {
      method: "PATCH",
      body: { title },
    }),
  mcpTools: () => request<unknown>("/api/education/mcp/tools"),
  ingestBofip: (requete: string, limite: number) =>
    request<unknown>(
      `/api/education/mcp/ingest-bofip?requete=${encodeURIComponent(requete)}&limite=${limite}`,
      { method: "POST", body: {} },
    ),
  veilleLast: () => request<Record<string, unknown>>("/api/education/veille/last"),
  veilleRun: () =>
    request<Record<string, unknown>>("/api/education/veille/run", { method: "POST", body: {} }),

  /* ---- Orchestrateur ---- */
  start: (body: {
    siret?: string;
    company_name?: string;
    branch?: "intake" | "guidance";
    skip_verification?: boolean;
  }) => request<OrchestratorResponse>("/api/orchestrator/start", { method: "POST", body }),
  turn: (body: { session_id: string; user_answer?: string }) =>
    request<OrchestratorResponse>("/api/orchestrator/turn", { method: "POST", body }),
  mySessions: () => request<SessionSummary[]>("/api/orchestrator/my-sessions"),
  sessionProfile: (id: string) =>
    request<Record<string, unknown>>(`/api/orchestrator/session/${id}`),
  sessionDetail: (id: string) =>
    request<SessionDetail>(`/api/orchestrator/session/${id}/detail`),
  sessionRoadmap: (id: string) => request<Roadmap>(`/api/orchestrator/session/${id}/roadmap`),
  saveRoadmapChecked: async (id: string, checked: Record<string, boolean>) => {
    const data = await request<{ session_id: string; checked: Record<string, boolean> }>(
      `/api/orchestrator/session/${id}/roadmap/state`,
      { method: "PUT", body: { checked } },
    );
    return data.checked ?? checked;
  },
  chooseParcours: (id: string, choix: "micro" | "societe") =>
    request<SessionDetail>(`/api/orchestrator/session/${id}/choix-parcours`, {
      method: "POST",
      body: { choix },
    }),
  patchDiagnosticProfile: (
    id: string,
    patch: Partial<DiagnosticProfile> & { rebuild_roadmap?: boolean },
  ) =>
    request<SessionDetail>(`/api/orchestrator/session/${id}/diagnostic-profile`, {
      method: "PATCH",
      body: patch,
    }),
  patchIntakeProfile: (
    id: string,
    patch: Record<string, unknown> & { reclassify?: boolean },
  ) =>
    request<SessionDetail>(`/api/orchestrator/session/${id}/profile`, {
      method: "PATCH",
      body: patch,
    }),
  downloadRoadmapPdf: async (id: string): Promise<Blob> => {
    const res = await request<Response>(`/api/orchestrator/session/${id}/roadmap/pdf`, {
      method: "POST",
      raw: true,
    });
    return res.blob();
  },
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/orchestrator/session/${id}`, { method: "DELETE" }),
  renameSession: (id: string, title: string) =>
    request<{ ok: boolean; session_id: string; title: string }>(
      `/api/orchestrator/session/${id}/rename`,
      { method: "PATCH", body: { title } },
    ),

  /**
   * Upload registre/SIRENE puis avance l'orchestrateur
   * (les endpoints de vérif ne renvoient pas un OrchestratorTurnResponse).
   */
  afterVerificationUpload: async (
    sessionId: string,
    upload: () => Promise<unknown>,
  ): Promise<OrchestratorResponse> => {
    await upload();
    return api.turn({ session_id: sessionId });
  },

  /* ---- Vérification ---- */
  ocrSiret: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<OcrSiretResult>("/api/verification/ocr-siret", { method: "POST", body: fd });
  },
  registryDocument: (sessionId: string, file: File) => {
    const fd = new FormData();
    fd.append("session_id", sessionId);
    fd.append("file", file);
    return request<RegistryDocUploadResult>("/api/verification/registry-document", {
      method: "POST",
      body: fd,
    });
  },
  sireneAvis: (sessionId: string, file: File) => {
    const fd = new FormData();
    fd.append("session_id", sessionId);
    fd.append("file", file);
    return request<SireneAvisUploadResult>("/api/verification/sirene-avis", {
      method: "POST",
      body: fd,
    });
  },

  /* ---- Capture ---- */
  captureAnalyze: (file: File, activite?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (activite) fd.append("activite", activite);
    return request<CaptureResult>("/api/capture/analyze", { method: "POST", body: fd });
  },
  captureAnswer: async (body: { thread_id: string; answer: string }): Promise<CaptureResult> => {
    const res = await request<CaptureAnswerResponse>("/api/capture/answer", {
      method: "POST",
      body,
    });
    if (res.analyze) return res.analyze;
    return {
      status: res.status,
      thread_id: res.thread_id,
      document_id: res.document_id,
      error: res.error,
      analysis: res.answer,
    };
  },
  captureQa: (body: { document_id: string; question: string }) =>
    request<CaptureQaAnswer>("/api/capture/qa", { method: "POST", body }),
  invoices: () => request<InvoiceListItem[]>("/api/capture/invoices"),
  virements: () => request<VirementListItem[]>("/api/capture/virements"),

  /* ---- Mise en relation ---- */
  referralGenerate: (body: { ville: string; demande: string }) =>
    request<ReferralResult>("/api/referral/generate", { method: "POST", body }),
  referralHistory: () => request<ReferralHistoryItem[]>("/api/referral/history"),
};

/** Map SessionDetail → shape utilisable comme tour d'orchestrateur. */
export function detailAsTurn(detail: SessionDetail): OrchestratorResponse {
  const phase = detail.phase;
  let ui_action: OrchestratorResponse["ui_action"] = "ask_question";
  if (phase === "verification") ui_action = "show_verification_result";
  else if (phase === "verification_registry_document") ui_action = "upload_registry_document";
  else if (phase === "verification_document") ui_action = "upload_sirene_document";
  else if (phase === "diagnostic_roadmap") ui_action = "show_roadmap";
  else if (phase === "tax_classification") ui_action = "show_tax_result";
  else if (phase === "compliance_check") ui_action = "show_compliance";
  else if (phase === "done") ui_action = "done";
  else if (phase === "profile_questions" || phase === "diagnostic_questions") ui_action = "ask_question";

  return {
    session_id: detail.session_id,
    phase: detail.phase,
    ui_action,
    message: null,
    quick_replies: [],
    profile: detail.profile,
    roadmap: detail.roadmap,
    diagnostic_profile: detail.diagnostic_profile,
    options: detail.options,
    roadmap_checked: detail.roadmap_checked,
    branch: detail.branch,
    title: detail.title,
  };
}
