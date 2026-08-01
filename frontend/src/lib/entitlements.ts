import { useEffect, useState } from "react";
import {
  getStoredUser,
  hasCompletedOnboarding,
  isAuthed,
  isSirenVerified,
  postAuthPath,
  type AuthUser,
} from "@/lib/auth";
import { usePlan, type Plan } from "@/lib/plan";

/**
 * Droits d'accès aux écrans, en un seul endroit.
 *
 * Trois conditions se combinent, dans cet ordre : être connecté, avoir la formule Premium, et
 * — pour ce qui dépend d'un dossier réellement instruit — avoir franchi la vérification SIREN.
 * Les écrans consomment `lockReason()` plutôt que de recombiner ces règles chacun de leur côté,
 * ce qui évite qu'un écran verrouille (ou déverrouille) pour une raison différente d'un autre.
 *
 * L'état de complétion vient de `lib/auth` (hasCompletedOnboarding / isSirenVerified /
 * postAuthPath) : c'est déjà la source de vérité du routage post-connexion, on ne la redérive
 * pas ici.
 */

export type Feature =
  | "dashboard"
  | "education"
  | "onboarding"
  | "activite"
  | "capture"
  | "referral"
  | "simulateur"
  | "historique"
  | "profile";

export type LockReason = "none" | "auth" | "premium" | "verification";

/** Écrans ouverts sans compte : le pédagogue et la porte d'entrée du parcours. */
const PUBLIC_FEATURES: ReadonlySet<Feature> = new Set(["education", "onboarding"]);

/** Écrans réservés à la formule Premium (mêmes que la barre de navigation). */
const PREMIUM_FEATURES: ReadonlySet<Feature> = new Set([
  "activite",
  "capture",
  "referral",
  "simulateur",
  "historique",
  "profile",
]);

/** Écrans qui n'ont de sens qu'une fois le SIREN et l'avis de situation vérifiés. */
const VERIFIED_FEATURES: ReadonlySet<Feature> = new Set(["activite", "capture", "historique"]);

export type Entitlements = {
  user: AuthUser | null;
  authed: boolean;
  plan: Plan;
  isPremium: boolean;
  onboardingComplete: boolean;
  sirenVerified: boolean;
  /** Où reprendre le parcours (ou le tableau de bord s'il est terminé). */
  resumePath: string;
  lockReason: (feature: Feature) => LockReason;
  canAccess: (feature: Feature) => boolean;
};

export const LOCK_MESSAGES: Record<Exclude<LockReason, "none">, string> = {
  auth: "Connectez-vous pour accéder à cet espace.",
  premium: "Cette fonctionnalité fait partie de la formule Premium.",
  verification:
    "Cet espace s'active après la vérification de votre SIREN et de votre avis de situation.",
};

export function useEntitlements(): Entitlements {
  const plan = usePlan();
  // Rendu serveur : visiteur. L'état réel est relu après hydratation, comme pour le plan.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setAuthed(isAuthed());
  }, []);

  const isPremiumPlan = plan === "premium";
  const onboardingComplete = hasCompletedOnboarding(user);
  const sirenVerified = isSirenVerified(user);

  const lockReason = (feature: Feature): LockReason => {
    if (!authed && !PUBLIC_FEATURES.has(feature)) return "auth";
    if (PREMIUM_FEATURES.has(feature) && !isPremiumPlan) return "premium";
    if (VERIFIED_FEATURES.has(feature) && !sirenVerified) return "verification";
    return "none";
  };

  return {
    user,
    authed,
    plan,
    isPremium: isPremiumPlan,
    onboardingComplete,
    sirenVerified,
    resumePath: authed ? postAuthPath(user) : "/onboarding",
    lockReason,
    canAccess: (feature) => lockReason(feature) === "none",
  };
}
