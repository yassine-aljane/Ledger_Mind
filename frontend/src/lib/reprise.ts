/**
 * Reprise d'un parcours interrompu.
 *
 * Quitter le parcours en cours de route ne doit jamais obliger à le recommencer : ni à
 * re-répondre au choix « avez-vous un SIREN ? », ni à ressaisir un SIRET déjà validé.
 * Ce module retrouve la session en cours et dit à quelle étape la reprendre.
 *
 * Deux sources d'identifiant, dans cet ordre :
 *   1. le stockage navigateur — le plus proche, mais fragile : il peut avoir été vidé,
 *      ou écrasé par un autre écran (le tableau de bord y écrit la session de guidance
 *      quand il en trouve une) ;
 *   2. `agent_context` du compte, côté serveur — c'est la mémoire qui fait autorité.
 */

import {
  fetchSessionDetail,
  getStoredSessionId,
  storeSessionId,
  type SessionDetail,
} from "@/lib/api";
import { fetchAgentContext } from "@/lib/auth";

export type Reprise = { sessionId: string; detail: SessionDetail };

/** Phases encore « en cours », et l'écran qui leur correspond. */
const ROUTE_PAR_PHASE: Record<string, string> = {
  verification: "/onboarding/verification",
  verification_registry_document: "/onboarding/verification",
  verification_document: "/onboarding/verification",
  profile_questions: "/onboarding/profil",
  diagnostic_questions: "/onboarding/diagnostic",
  diagnostic_roadmap: "/onboarding/diagnostic/resultat",
};

/**
 * Écran où reprendre ce parcours, ou `null` s'il n'y a rien à reprendre.
 *
 * Les phases terminales (`tax_classification`, `compliance_check`, `done`) renvoient
 * `null` : le dossier est instruit, ce n'est plus au parcours de s'en occuper.
 */
export function routeDeReprise(detail: SessionDetail): string | null {
  return ROUTE_PAR_PHASE[detail.phase] ?? null;
}

async function identifiantsCandidats(): Promise<string[]> {
  const ids: string[] = [];
  try {
    const local = getStoredSessionId();
    if (local) ids.push(local);
  } catch {
    // Stockage indisponible (navigation privée) : on s'en remet au serveur.
  }
  try {
    const ctx = await fetchAgentContext();
    for (const id of [ctx.intake?.last_session_id, ctx.guidance?.last_session_id]) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  } catch {
    // Compte injoignable : on se contente de ce que le navigateur a gardé.
  }
  return ids;
}

/**
 * Retrouve la session en cours, ou `null` si aucune n'est reprenable.
 *
 * `branche` restreint la recherche quand l'écran appelant n'accepte qu'un parcours
 * précis (la page de vérification ne sait rien faire d'une session de guidance).
 *
 * Effet de bord assumé : la session retrouvée devient la session courante du
 * navigateur, pour que les écrans suivants parlent bien de celle-ci.
 */
export async function repriseEnCours(
  branche?: "intake" | "guidance",
): Promise<Reprise | null> {
  for (const sessionId of await identifiantsCandidats()) {
    let detail: SessionDetail;
    try {
      detail = await fetchSessionDetail(sessionId);
    } catch {
      continue; // session expirée ou supprimée : on tente la suivante
    }
    if (branche && detail.branch !== branche) continue;
    storeSessionId(sessionId);
    return { sessionId, detail };
  }
  return null;
}
