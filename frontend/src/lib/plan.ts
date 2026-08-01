import { useEffect, useState } from "react";

/**
 * Formule (démo) de l'utilisateur courant.
 *
 * Le plan est mémorisé PAR COMPTE (`lm.plan.<uid>`), pas dans une clé globale au navigateur :
 * sur un poste partagé, le Premium d'un compte ne doit ni s'afficher ni disparaître pour un
 * autre — et un utilisateur qui se reconnecte retrouve sa formule. La clé anonyme
 * (`lm.plan.anon`) sert avant connexion et n'est jamais promue vers un compte.
 *
 * L'ancienne clé globale `lm.plan` est migrée une seule fois vers le compte courant, pour ne pas
 * dégrader un Premium déjà débloqué par l'utilisateur connecté au moment de la mise à jour.
 *
 * Ceci reste une démo côté client : aucun endpoint de paiement n'existe côté backend, et la
 * bascule se fait depuis /premium.
 */

export type Plan = "free" | "premium";

const LEGACY_KEY = "lm.plan";
const PREFIX = "lm.plan.";
const ANON = `${PREFIX}anon`;
const USER_KEY = "ledgermind_user";
const EVT = "lm.plan.change";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Identifiant du compte connecté, lu directement du stockage pour éviter une dépendance
 * circulaire avec `lib/auth` (qui, lui, appelle `setPlan` à la connexion/déconnexion). */
function currentUid(): string | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function planKey(): string {
  const uid = currentUid();
  return uid ? `${PREFIX}${uid}` : ANON;
}

function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "premium";
}

export function getPlan(): Plan {
  const s = storage();
  if (!s) return "free";
  try {
    const key = planKey();
    const stored = s.getItem(key);
    if (isPlan(stored)) return stored;

    // Migration unique depuis la clé globale historique, uniquement vers le compte connecté.
    const legacy = s.getItem(LEGACY_KEY);
    if (isPlan(legacy) && key !== ANON) {
      s.setItem(key, legacy);
      s.removeItem(LEGACY_KEY);
      return legacy;
    }
    return "free";
  } catch {
    return "free";
  }
}

export function setPlan(p: Plan) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(planKey(), p);
    s.removeItem(LEGACY_KEY);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    // stockage indisponible : la formule reste celle de la session en cours
  }
}

/** À appeler quand le compte change (connexion / déconnexion) : la formule affichée doit
 * repartir de celle du nouveau compte, pas de l'ancienne. */
export function refreshPlan() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT));
}

export function isPremium() {
  return getPlan() === "premium";
}

export function usePlan(): Plan {
  // Rendu serveur et premier rendu client partent de "free" : le stockage n'existe pas côté
  // serveur, et l'effet resynchronise juste après l'hydratation.
  const [plan, setState] = useState<Plan>("free");
  useEffect(() => {
    const sync = () => setState(getPlan());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return plan;
}
