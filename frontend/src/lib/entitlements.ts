import { useEffect, useState } from "react";
import {
  fetchMe,
  getStoredUser,
  hasCompletedOnboarding,
  isAuthed,
  isSirenVerified,
  type AuthUser,
} from "@/lib/auth";
import { usePlan, type Plan } from "@/lib/plan";

/**
 * Droits d'accès aux écrans, en un seul endroit.
 *
 * Règle de fond : **le gratuit sert à COMPRENDRE, le Premium à AGIR.** L'Éducation est ouverte à
 * tous, y compris sans compte. Tout le reste suppose la formule Premium, et les outils ne
 * s'ouvrent qu'une fois le parcours d'onboarding terminé — livrer le tableau de bord ou la
 * capture à quelqu'un dont le dossier n'est pas instruit ne produirait que des écrans vides.
 *
 * Quatre états, et un seul : ils sont exclusifs et couvrent tous les cas.
 *
 *   invite              pas connecté
 *   free                connecté, sans Premium
 *   premium_parcours    Premium, parcours d'onboarding pas encore terminé
 *   premium_complet     Premium, parcours terminé
 *
 * Les écrans consomment `lockReason()` plutôt que de recombiner ces règles chacun de leur côté :
 * sans ça, deux écrans finissent tôt ou tard par verrouiller pour des raisons différentes.
 */

export type AccessState = "invite" | "free" | "premium_parcours" | "premium_complet";

export type Feature =
  | "education"
  | "profile"
  | "onboarding"
  | "roadmap"
  | "dashboard"
  | "activite"
  | "capture"
  | "referral"
  | "simulateur"
  | "historique";

/**
 * Pourquoi un écran est fermé.
 *
 *   none          ouvert
 *   auth          il faut un compte
 *   premium       il faut la formule Premium
 *   parcours      Premium acquis, mais le parcours d'onboarding n'est pas terminé
 *   deja_fait     le parcours est terminé : on ne le refait pas, on va au tableau de bord
 */
export type LockReason = "none" | "auth" | "premium" | "parcours" | "deja_fait";

/** Ouvert à tous, même sans compte : c'est la porte d'entrée du produit. */
const PUBLIC_FEATURES: ReadonlySet<Feature> = new Set<Feature>(["education"]);

/**
 * Premium requis, mais SANS attendre la fin du parcours.
 *
 * Le profil décrit le compte lui-même : identité, régime, préférences, accès. Un abonné dont
 * le parcours est encore en cours doit pouvoir le consulter et le corriger — c'est justement
 * là qu'il ira vérifier ce qu'il a saisi.
 */
const PREMIUM_SANS_PARCOURS: ReadonlySet<Feature> = new Set<Feature>(["profile", "roadmap"]);

/** Outils : Premium **et** parcours terminé. */
const TOOL_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  "dashboard",
  "activite",
  "capture",
  "referral",
  "simulateur",
  "historique",
]);

export const LOCK_MESSAGES: Record<Exclude<LockReason, "none">, string> = {
  auth: "Connectez-vous pour accéder à cet espace.",
  premium: "Cette fonctionnalité fait partie de la formule Premium.",
  parcours: "Terminez votre parcours fiscal pour débloquer cet espace.",
  deja_fait: "Votre parcours est déjà terminé.",
};

export type Entitlements = {
  user: AuthUser | null;
  authed: boolean;
  plan: Plan;
  isPremium: boolean;
  /** Le parcours d'onboarding est instruit (SIREN vérifié ou diagnostic + feuille de route). */
  parcoursDone: boolean;
  state: AccessState;
  /** L'état réel n'est connu qu'après hydratation : ne rien verrouiller ni rediriger avant. */
  loading: boolean;
  /** Où atterrir après connexion, après activation Premium, ou depuis un écran bloqué. */
  landingPath: string;
  lockReason: (feature: Feature) => LockReason;
  canAccess: (feature: Feature) => boolean;
};

/**
 * Le parcours compte comme fait dès que le dossier est instruit — soit par la branche A
 * (SIREN vérifié), soit par la branche B (diagnostic et feuille de route). Le tableau de bord
 * sait déjà présenter le cas « branche B seule » en accès partiel, il n'a pas besoin d'être
 * fermé pour autant.
 */
export function isParcoursDone(user: AuthUser | null | undefined): boolean {
  return isSirenVerified(user) || hasCompletedOnboarding(user);
}

/**
 * Le parcours est-il réellement ARRIVÉ À SON TERME ?
 *
 * À ne pas confondre avec `isParcoursDone`, qui ouvre les outils dès le SIREN vérifié.
 * La vérification du SIRET n'est que la PREMIÈRE étape de la branche A : viennent ensuite
 * le dépôt du KBIS, les questions de profil, puis la classification fiscale. Se fier à
 * `isParcoursDone` pour masquer l'entrée « Parcours fiscal » enfermait l'utilisateur au
 * milieu de son propre parcours, sans moyen d'y revenir.
 *
 * `hasCompletedOnboarding` regarde, lui, l'aboutissement : régime recommandé, feuille de
 * route, ou phase terminale.
 */
export function isParcoursAcheve(user: AuthUser | null | undefined): boolean {
  return hasCompletedOnboarding(user);
}

export function accessState(authed: boolean, plan: Plan, parcoursDone: boolean): AccessState {
  if (!authed) return "invite";
  if (plan !== "premium") return "free";
  return parcoursDone ? "premium_complet" : "premium_parcours";
}

/**
 * Destination naturelle d'un état donné.
 *
 *   free              → Éducation : c'est tout ce à quoi il a droit
 *   premium_parcours  → l'onboarding, qu'il doit finir avant les outils
 *   premium_complet   → le tableau de bord
 *   invité            → l'authentification
 */
export function landingPathFor(state: AccessState): string {
  switch (state) {
    case "invite":
      return "/auth";
    case "free":
      return "/education";
    case "premium_parcours":
      return "/onboarding";
    case "premium_complet":
      return "/dashboard";
  }
}

export function lockReasonFor(
  feature: Feature,
  state: AccessState,
  /**
   * Le parcours est-il réellement achevé ? Par défaut `true` pour préserver le
   * comportement des appelants qui ne s'en soucient pas ; seul l'aiguillage de
   * l'entrée « Parcours fiscal » en dépend.
   */
  parcoursAcheve: boolean = true,
): LockReason {
  if (PUBLIC_FEATURES.has(feature)) return "none";

  if (state === "invite") return "auth";

  if (state === "free") return "premium";

  // À partir d'ici : connecté ET Premium. Reste à savoir où en est le parcours.
  // La feuille de route est le RÉSULTAT du parcours, pas le parcours : la fermer une fois le
  // dossier instruit reviendrait à priver l'utilisateur de son propre diagnostic.
  if (PREMIUM_SANS_PARCOURS.has(feature)) return "none";

  if (feature === "onboarding") {
    // Le parcours ne se refait pas UNE FOIS ACHEVÉ : on renvoie alors au tableau de bord
    // plutôt que de laisser réécrire un diagnostic déjà validé. Tant qu'il est en cours —
    // SIRET vérifié mais KBIS, profil ou classification encore à faire — l'entrée doit
    // rester ouverte, sinon l'utilisateur ne peut plus reprendre là où il s'est arrêté.
    return state === "premium_complet" && parcoursAcheve ? "deja_fait" : "none";
  }

  if (TOOL_FEATURES.has(feature)) {
    return state === "premium_complet" ? "none" : "parcours";
  }

  return "none";
}

export function useEntitlements(): Entitlements {
  const plan = usePlan();
  // Rendu serveur et premier rendu client : visiteur. L'état réel est relu après hydratation,
  // comme pour le plan — d'où `loading`, que les écrans doivent respecter avant de rediriger.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => {
      setUser(getStoredUser());
      setAuthed(isAuthed());
      setLoading(false);
    };
    // Chemin rapide : on statue immédiatement sur le compte mis en cache, sans attendre le
    // réseau — sinon chaque écran protégé afficherait un état d'attente à chaque navigation.
    sync();
    window.addEventListener("storage", sync);

    // Puis on resynchronise depuis le serveur : le cache peut dater d'avant la fin du parcours,
    // auquel cas l'utilisateur resterait bloqué derrière « terminez votre parcours ». Un échec
    // 401 vide la session côté `fetchMe`, ce qui nous ramène proprement à l'état visiteur.
    let annule = false;
    if (isAuthed()) {
      fetchMe()
        .then((u) => {
          if (!annule) setUser(u);
        })
        .catch(() => {
          if (!annule) sync();
        });
    }

    return () => {
      annule = true;
      window.removeEventListener("storage", sync);
    };
  }, []);

  const parcoursDone = isParcoursDone(user);
  const parcoursAcheve = isParcoursAcheve(user);
  const state = accessState(authed, plan, parcoursDone);

  return {
    user,
    authed,
    plan,
    isPremium: plan === "premium",
    parcoursDone,
    state,
    loading,
    landingPath: landingPathFor(state),
    lockReason: (feature) => lockReasonFor(feature, state, parcoursAcheve),
    canAccess: (feature) => lockReasonFor(feature, state, parcoursAcheve) === "none",
  };
}
