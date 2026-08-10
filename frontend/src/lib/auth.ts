/** Mongo-backed auth client (JWT). No Supabase. */

import { refreshPlan } from "@/lib/plan";

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

/**
 * True une fois le SIREN (et l'avis de situation) vérifiés — branche A de l'intake.
 *
 * Un utilisateur venu de la seule guidance (branche B) a un diagnostic et une feuille de route,
 * mais rien n'est vérifié administrativement : les fonctionnalités qui en dépendent (reçu
 * fiscal, expert-comptable, documents, simulateur, historique détaillé) doivent rester
 * inaccessibles tant que cette étape n'est pas franchie.
 */
export function isSirenVerified(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  const profil = user.agent_context?.intake?.profile as
    | { verification_status?: unknown; tax_category?: unknown }
    | null
    | undefined;
  if (!profil) return false;
  if (profil.verification_status === "verified") return true;
  // Repli : le profil n'atteint la classification fiscale qu'après la vérification, dans la
  // machine à états de la branche A — sa présence signale donc indirectement une vérification.
  return Boolean(profil.tax_category);
}

/**
 * Post-login destination from saved agent context.
 *
 * Une feuille de route de branche B (guidance) ne vaut pas vérification SIREN : tant qu'elle
 * n'est pas faite, l'utilisateur doit rester sur son parcours guidage (roadmap, avancement,
 * checklist), pas sur le dashboard "immatriculé" — même si un diagnostic complet est déjà là.
 */
export function postAuthPath(
  user: AuthUser | null | undefined,
): "/dashboard" | "/onboarding" | "/onboarding/diagnostic/resultat" {
  // Branche A terminée (vérif + intake) → tableau de bord.
  if (isSirenVerified(user) && hasCompletedOnboarding(user)) return "/dashboard";
  // Branche B terminée (diagnostic) → feuille de route ; le SIREN reste à faire plus tard.
  if (hasCompletedOnboarding(user)) return "/onboarding/diagnostic/resultat";
  // Parcours en cours : /onboarding reprend à la dernière étape (voir repriseEnCours).
  return "/onboarding";
}

export function isAuthed(): boolean {
  return Boolean(getAccessToken());
}

export function storeAuth(res: AuthResponse): void {
  const s = storage();
  if (!s) return;

  s.setItem(TOKEN_KEY, res.access_token);
  s.setItem(USER_KEY, JSON.stringify(res.user));
  // Le plan (démo) est stocké par compte (voir lib/plan.ts) : il suffit de signaler le
  // changement de compte pour que l'interface réaffiche la formule du nouvel utilisateur —
  // sans écraser celle du précédent, et sans lui faire hériter du Premium d'un autre.
  refreshPlan();
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
  // L'identifiant de session appartient au compte qu'on quitte. Le laisser derrière soi le
  // ferait réclamer par le compte suivant, qui recevrait un 403 sur chaque écran — c'est
  // exactement ce qui vidait « Ma situation » sans rien expliquer.
  try {
    localStorage.removeItem("ledgermind_session_id");
    sessionStorage.removeItem("ledgermind_session_id");
  } catch {
    /* ignore private-mode failures */
  }
  // La formule reste attachée au compte : on ne l'efface pas, on signale juste que la session
  // visible redevient anonyme (l'utilisateur retrouvera son Premium en se reconnectant).
  refreshPlan();
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
