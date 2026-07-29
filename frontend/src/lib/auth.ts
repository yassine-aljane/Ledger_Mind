/** Mongo-backed auth client (JWT). No Supabase. */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

const TOKEN_KEY = "ledgermind_access_token";
const USER_KEY = "ledgermind_user";
const LEGACY_AUTH_KEY = "ledgermind_auth";

export type BranchAgentContext = {
  last_session_id: string | null;
  phase: string | null;
  updated_at: string | null;
  completeness: number | null;
  recommended_regime: string | null;
  profile: Record<string, unknown> | null;
  diagnostic_profile: Record<string, unknown> | null;
  roadmap: Record<string, unknown> | null;
};

export type UserAgentContext = {
  intake: BranchAgentContext;
  guidance: BranchAgentContext;
  capture?: {
    last_thread_id: string | null;
    last_document_id: string | null;
    updated_at: string | null;
    history: Record<string, unknown>[];
  };
  referral?: {
    history: Record<string, unknown>[];
  };
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  agent_context: UserAgentContext;
};

export type AuthResponse = {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function getStoredUser(): AuthUser | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/** Full display name, e.g. "Alexandre Martin". */
export function displayName(user: AuthUser | null | undefined): string {
  const n = user?.name?.trim();
  if (n) return n;
  const email = user?.email?.trim();
  if (email) return email.split("@")[0] || "Compte";
  return "Compte";
}

/** Short nav label, e.g. "Alexandre M." */
export function displayShortName(user: AuthUser | null | undefined): string {
  const full = displayName(user);
  if (full === "Compte") return full;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

/** First name for greetings. */
export function displayFirstName(user: AuthUser | null | undefined): string {
  const full = displayName(user);
  if (full === "Compte") return full;
  return full.split(/\s+/)[0] || full;
}

/**
 * True if the user already finished intake and/or guidance —
 * reconnect should go to dashboard, not redo the chatbot.
 */
export function hasCompletedOnboarding(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  const g = user.agent_context?.guidance;
  const i = user.agent_context?.intake;

  const guidanceDone = Boolean(
    g?.last_session_id &&
      (g.recommended_regime ||
        g.roadmap ||
        g.phase === "diagnostic_roadmap" ||
        g.phase === "done"),
  );

  const intakeDone = Boolean(
    i?.last_session_id &&
      (i.recommended_regime ||
        i.phase === "done" ||
        (i.profile &&
          typeof i.profile === "object" &&
          (i.profile as { tax_category?: unknown }).tax_category)),
  );

  return guidanceDone || intakeDone;
}

/** Post-login destination from saved agent context. */
export function postAuthPath(user: AuthUser | null | undefined): "/dashboard" | "/onboarding" {
  return hasCompletedOnboarding(user) ? "/dashboard" : "/onboarding";
}

export function isAuthed(): boolean {
  return Boolean(getAccessToken());
}

export function storeAuth(res: AuthResponse): void {
  const s = storage();
  if (!s) return;
  s.setItem(TOKEN_KEY, res.access_token);
  s.setItem(USER_KEY, JSON.stringify(res.user));
  // Clear legacy mock flag
  try {
    s.removeItem(LEGACY_AUTH_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAuth(): void {
  const s = storage();
  if (!s) return;
  s.removeItem(TOKEN_KEY);
  s.removeItem(USER_KEY);
  try {
    s.removeItem(LEGACY_AUTH_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_KEY);
  } catch {
    /* ignore */
  }
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAccessToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function detailMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "detail" in err) {
    const d = (err as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg: unknown }).msg) : String(x)))
        .join(" · ");
    }
  }
  return fallback;
}

export async function registerAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailMessage(body, `Inscription impossible (${response.status})`));
  }
  const data = body as AuthResponse;
  storeAuth(data);
  return data;
}

export async function loginAccount(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailMessage(body, `Connexion impossible (${response.status})`));
  }
  const data = body as AuthResponse;
  storeAuth(data);
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: authHeaders(),
  });
  if (response.status === 401) {
    clearAuth();
    throw new Error("Session expirée — reconnectez-vous.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailMessage(body, `Erreur profil (${response.status})`));
  }
  const user = body as AuthUser;
  const s = storage();
  s?.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function fetchAgentContext(): Promise<UserAgentContext> {
  const response = await fetch(`${API_BASE}/api/auth/context`, {
    headers: authHeaders(),
  });
  if (response.status === 401) {
    clearAuth();
    throw new Error("Session expirée — reconnectez-vous.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailMessage(body, `Erreur contexte (${response.status})`));
  }
  return body as UserAgentContext;
}

export function logout(): void {
  clearAuth();
}
