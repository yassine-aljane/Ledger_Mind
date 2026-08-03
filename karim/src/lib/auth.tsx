import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError, clearLegacyGlobalTier, consumePendingPremium, getToken, resolveSubscriptionTier, setToken, withLocalTier } from "./api";
import { clearAllSessions, clearSession, loadSession, type FlowBranch } from "./session-store";
import type { AgentContext, SubscriptionTier, UserPublic } from "./types";

export type Feature =
  | "education"
  | "profile"
  | "onboarding"
  | "intake"
  | "guidance"
  | "roadmap"
  | "capture"
  | "referral"
  | "dashboard"
  | "historique"
  | "simulateur";

/** Free (connecté) : éducation + profil (nom / email). Le reste est Premium. */
const FREE_FEATURES: Feature[] = ["education", "profile"];

/** Premium tools locked until verification + onboarding are finished. */
export const GATED_PREMIUM_FEATURES: Feature[] = [
  "dashboard",
  "capture",
  "referral",
  "historique",
  "simulateur",
];

/** Onboarding steps — accessible to Premium users still completing the parcours. */
const ONBOARDING_FEATURES: Feature[] = ["onboarding", "intake", "guidance", "roadmap"];

function checkAgentContext(ctx: AgentContext | undefined): boolean {
  if (!ctx) return false;
  const g = ctx.guidance;
  const i = ctx.intake;

  const guidanceDone = Boolean(
    g?.last_session_id &&
      (g.phase === "done" ||
        g.phase === "diagnostic_roadmap" ||
        Boolean(g.roadmap && g.recommended_regime)),
  );

  const intakeProfile =
    i?.profile && typeof i.profile === "object"
      ? (i.profile as {
          tax_category?: unknown;
          verification_status?: string;
          fiscal_classification_status?: string;
        })
      : null;
  const verificationOk =
    intakeProfile?.verification_status === "verified" ||
    intakeProfile?.verification_status === "skipped";

  // Phase "done" = questions + classification terminées (même si régime à arbitrer / expert).
  const intakeDone = Boolean(
    i?.last_session_id &&
      i.phase === "done" &&
      verificationOk &&
      (i.recommended_regime ||
        intakeProfile?.tax_category ||
        intakeProfile?.fiscal_classification_status === "confirmed" ||
        intakeProfile?.fiscal_classification_status === "requires_expert"),
  );

  return guidanceDone || intakeDone;
}

export type ResumePath =
  | "/onboarding"
  | "/onboarding/verification"
  | "/onboarding/profil"
  | "/onboarding/diagnostic"
  | "/onboarding/diagnostic/resultat"
  | "/dashboard";

type OnboardingSnapshot = { complete: boolean; resumePath: ResumePath };

let onboardingCache: { userId: string; key: string; snapshot: OnboardingSnapshot } | null = null;
let onboardingInflight: { key: string; promise: Promise<OnboardingSnapshot> } | null = null;
let onboardingEpoch = 0;

export function invalidateOnboardingCache() {
  onboardingCache = null;
  onboardingInflight = null;
  onboardingEpoch += 1;
}

function onboardingUserKey(user: UserPublic): string {
  const g = user.agent_context?.guidance;
  const i = user.agent_context?.intake;
  return [
    user.id,
    g?.phase ?? "",
    g?.last_session_id ?? "",
    i?.phase ?? "",
    i?.last_session_id ?? "",
    i?.recommended_regime ?? "",
  ].join("|");
}

async function safeSessionDetail(branch: FlowBranch, sessionId: string) {
  try {
    return await api.sessionDetail(sessionId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      clearSession(branch);
    }
    return null;
  }
}

async function resolveOnboardingState(user: UserPublic): Promise<OnboardingSnapshot> {
  if (hasCompletedOnboarding(user)) {
    return { complete: true, resumePath: "/dashboard" };
  }

  if (!user.agent_context) {
    try {
      const ctx = await api.context();
      if (checkAgentContext(ctx)) {
        return { complete: true, resumePath: "/dashboard" };
      }
    } catch {
      /* ignore */
    }
  }

  const intakeId = loadSession("intake");
  if (intakeId) {
    const d = await safeSessionDetail("intake", intakeId);
    if (d) {
      if (d.phase === "done") return { complete: true, resumePath: "/dashboard" };
      if (d.phase === "profile_questions") {
        return { complete: false, resumePath: "/onboarding/profil" };
      }
      return { complete: false, resumePath: "/onboarding/verification" };
    }
  }

  const guidanceId = loadSession("guidance");
  if (guidanceId) {
    const d = await safeSessionDetail("guidance", guidanceId);
    if (d) {
      if (d.phase === "done" || d.phase === "diagnostic_roadmap" || Boolean(d.roadmap)) {
        return { complete: true, resumePath: "/onboarding/diagnostic/resultat" };
      }
      return { complete: false, resumePath: "/onboarding/diagnostic" };
    }
  }

  return { complete: false, resumePath: "/onboarding" };
}

async function getOnboardingState(user: UserPublic): Promise<OnboardingSnapshot> {
  const key = onboardingUserKey(user);
  if (onboardingCache?.userId === user.id && onboardingCache.key === key) {
    return onboardingCache.snapshot;
  }
  if (onboardingInflight?.key === key) return onboardingInflight.promise;

  const epoch = onboardingEpoch;
  const promise = resolveOnboardingState(user)
    .then((snapshot) => {
      if (epoch === onboardingEpoch) {
        onboardingCache = { userId: user.id, key, snapshot };
      }
      return snapshot;
    })
    .finally(() => {
      if (onboardingInflight?.promise === promise) onboardingInflight = null;
    });

  onboardingInflight = { key, promise };
  return promise;
}

/**
 * Intake (SIRET) or guidance (sans SIRET) fully finished → dashboard allowed.
 */
export function hasCompletedOnboarding(user: UserPublic | null | undefined): boolean {
  if (!user) return false;
  return checkAgentContext(user.agent_context as AgentContext | undefined);
}

/** Fresh context + local session fallback (agent_context can lag right after a turn). */
export async function resolveOnboardingComplete(
  user: UserPublic | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  return (await getOnboardingState(user)).complete;
}

/** Where to send a Premium user who still owes onboarding steps. */
export async function resolveOnboardingResumePath(
  user?: UserPublic | null,
): Promise<ResumePath> {
  if (user) return (await getOnboardingState(user)).resumePath;

  const intakeId = loadSession("intake");
  if (intakeId) {
    const d = await safeSessionDetail("intake", intakeId);
    if (d) {
      if (d.phase === "done") return "/dashboard";
      if (d.phase === "profile_questions") return "/onboarding/profil";
      return "/onboarding/verification";
    }
  }

  const guidanceId = loadSession("guidance");
  if (guidanceId) {
    const d = await safeSessionDetail("guidance", guidanceId);
    if (d) {
      if (d.phase === "done" || d.phase === "diagnostic_roadmap" || Boolean(d.roadmap)) {
        return "/onboarding/diagnostic/resultat";
      }
      return "/onboarding/diagnostic";
    }
  }

  return "/onboarding";
}

/** Destination after login / Premium activation (old-app logic). */
export function postAuthPath(user: UserPublic | null | undefined): "/education" | "/dashboard" | "/onboarding" {
  if (!user) return "/education";
  if (resolveSubscriptionTier(user) !== "premium") return "/education";
  return hasCompletedOnboarding(user) ? "/dashboard" : "/onboarding";
}

interface AuthState {
  user: UserPublic | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<UserPublic>;
  signUp: (email: string, password: string, name: string) => Promise<UserPublic>;
  signOut: () => void;
  refresh: () => Promise<void>;
  setUser: (u: UserPublic | null) => void;
  /** Activation Premium statique (localStorage). */
  activatePremium: () => Promise<UserPublic>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    invalidateOnboardingCache();
    clearLegacyGlobalTier();
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      try {
        const ctx = await api.context();
        setUser({ ...me, agent_context: ctx });
      } catch {
        setUser(me);
      }
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const finalize = useCallback(async (token: string, fallback?: UserPublic) => {
    invalidateOnboardingCache();
    setToken(token);
    try {
      const me = await api.me();
      try {
        const ctx = await api.context();
        const merged = { ...me, agent_context: ctx };
        setUser(merged);
        return merged;
      } catch {
        setUser(me);
        return me;
      }
    } catch {
      const u = withLocalTier(
        fallback ?? ({ id: "me", email: "", name: "" } as UserPublic),
      );
      setUser(u);
      return u;
    }
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      return finalize(res.access_token, res.user);
    },
    [finalize],
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      const res = await api.register({ email, password, name });
      return finalize(res.access_token, res.user);
    },
    [finalize],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    clearAllSessions();
    invalidateOnboardingCache();
  }, []);

  const activatePremium = useCallback(async () => {
    if (!getToken()) {
      throw new Error("Connectez-vous pour activer Premium.");
    }
    const upgraded = await api.upgrade();
    invalidateOnboardingCache();
    setUser(upgraded);
    return upgraded;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      signOut,
      refresh,
      setUser,
      activatePremium,
    }),
    [user, loading, signIn, signUp, signOut, refresh, activatePremium],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}

export type LockReason = "none" | "auth" | "premium" | "parcours" | "done";

interface EntitlementsState {
  tier: SubscriptionTier;
  isPremium: boolean;
  isAuthenticated: boolean;
  loading: boolean;
  canAccess: (feature: Feature) => boolean;
  lockReason: (feature: Feature) => LockReason;
  onboardingComplete: boolean;
  resumePath: ResumePath;
}

const EntitlementsContext = createContext<EntitlementsState | null>(null);

/** Single shared resolution — avoids N parallel /auth/context + /session/detail calls. */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const tier: SubscriptionTier = resolveSubscriptionTier(user);
  const isAuthenticated = !!user;
  const isPremium = isAuthenticated && tier === "premium";
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [resolving, setResolving] = useState(false);

  const onboardingKey = useMemo(() => {
    if (!user) return "guest";
    const g = user.agent_context?.guidance;
    const i = user.agent_context?.intake;
    return [
      user.id,
      g?.phase ?? "",
      g?.last_session_id ?? "",
      i?.phase ?? "",
      i?.last_session_id ?? "",
    ].join("|");
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSnapshot(null);
      setResolving(false);
      return;
    }
    if (!isPremium) {
      setSnapshot({ complete: false, resumePath: "/onboarding" });
      setResolving(false);
      return;
    }
    if (hasCompletedOnboarding(user)) {
      setSnapshot({ complete: true, resumePath: "/dashboard" });
      setResolving(false);
      return;
    }
    let alive = true;
    setResolving(true);
    // Keep previous snapshot while resolving — avoids blank PremiumGate flash.
    void getOnboardingState(user).then((next) => {
      if (alive) {
        setSnapshot(next);
        setResolving(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [onboardingKey, isPremium, user]);

  const onboardingComplete = isPremium ? (snapshot?.complete ?? false) : false;
  const resumePath: ResumePath = snapshot?.resumePath ?? "/onboarding";
  // Premium without a resolved snapshot yet → wait (avoid flashing locks / empty gates).
  const loading = authLoading || (isPremium && snapshot === null);

  const canAccess = useCallback(
    (feature: Feature) => {
      if (feature === "education") return true;
      if (feature === "profile") return isAuthenticated;
      if (!isAuthenticated) return false;
      if (!isPremium) return FREE_FEATURES.includes(feature);
      // Parcours : ouvert seulement tant qu'il n'est pas terminé.
      if (ONBOARDING_FEATURES.includes(feature)) return !onboardingComplete;
      if (GATED_PREMIUM_FEATURES.includes(feature)) return onboardingComplete;
      return onboardingComplete;
    },
    [isAuthenticated, isPremium, onboardingComplete],
  );

  const lockReason = useCallback(
    (feature: Feature): LockReason => {
      if (canAccess(feature)) return "none";
      if (!isAuthenticated) return "auth";
      if (!isPremium) return "premium";
      if (ONBOARDING_FEATURES.includes(feature) && onboardingComplete) return "done";
      return "parcours";
    },
    [canAccess, isAuthenticated, isPremium, onboardingComplete],
  );

  const value = useMemo(
    () => ({
      tier,
      isPremium,
      isAuthenticated,
      loading,
      canAccess,
      lockReason,
      onboardingComplete,
      resumePath,
    }),
    [
      tier,
      isPremium,
      isAuthenticated,
      loading,
      canAccess,
      lockReason,
      onboardingComplete,
      resumePath,
    ],
  );

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlements() {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error("useEntitlements doit être utilisé dans <EntitlementsProvider>");
  return ctx;
}
