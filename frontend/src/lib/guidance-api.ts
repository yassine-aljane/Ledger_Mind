// Client de l'espace « pas encore immatriculé » : chat conversationnel, mémoire, feuille de route.
// Complète `api.ts` (orchestrateur de la branche SIREN) — même base d'URL, même auth.

import { authHeaders, clearAuth } from "@/lib/auth";
import { getAnonId } from "@/lib/anon";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";
const BASE = `${API_BASE}/api/guidance`;

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) clearAuth();
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      "X-Anon-Id": getAnonId(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------- Types

/** Profil de guidance — chaque clé renseignée devient une carte de la fiche de statut. */
export type GuidanceProfile = {
  activite?: string | null;
  ca_estime?: number | null;
  ca_prestations?: number | null;
  ca_vente?: number | null;
  remuneration_nature?: number | null;
  devise?: string | null;
  vend_produits?: boolean | null;
  recoit_cadeaux?: boolean | null;
  situation_actuelle?: string | null;
  deja_immatricule?: boolean | null;
  choix_parcours?: string | null;
  ca_n_1_au_dessus_seuil?: boolean | null;
};

export type ChatSource = {
  titre?: string;
  url?: string;
  source?: string;
  score?: number | null;
  /** Extrait exact ayant servi à la réponse — déplié au clic sur la source. */
  texte?: string;
  extrait?: string;
};

/** Options cliquables décidées par le BACKEND — le front n'en code aucune en dur. */
export type ChatOptions = {
  kind: string;
  prompt?: string;
  choices: { label: string; value: string }[];
};

export type GuidanceChatResponse = {
  session_id: string;
  reponse: string;
  sources: ChatSource[];
  profil: GuidanceProfile;
  roadmap: Record<string, any> | null;
  options: ChatOptions | null;
  suggestions: string[];
  profil_complet: boolean;
  debug?: Record<string, unknown>;
};

export type ConversationSummary = {
  id: string;
  type: string;
  title: string;
  apercu: string;
  date: string;
};

export type ConversationDetail = {
  session_id: string;
  type: string;
  title: string | null;
  messages: { role: string; content: string; sources: ChatSource[]; created_at: string }[];
  profil: GuidanceProfile;
  roadmap: Record<string, any> | null;
  checked: Record<string, boolean>;
  profil_complet: boolean;
};

// ---------------------------------------------------------------------------- Appels

export function sendGuidanceMessage(payload: {
  session_id?: string | null;
  message: string;
  mode?: "guidance" | "pedagogue";
  action?: { kind: string; value: string } | null;
}): Promise<GuidanceChatResponse> {
  return request<GuidanceChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: payload.session_id ?? null,
      message: payload.message,
      mode: payload.mode ?? "guidance",
      action: payload.action ?? null,
    }),
  });
}

export function fetchSuggestions(): Promise<{
  suggestions: string[];
  profil: GuidanceProfile;
  profil_complet: boolean;
}> {
  return request("/suggestions");
}

export function fetchConversations(type = "guidance"): Promise<{
  conversations: ConversationSummary[];
}> {
  return request(`/conversations?type=${encodeURIComponent(type)}`);
}

export function fetchConversation(sessionId: string): Promise<ConversationDetail> {
  return request(`/chat/${encodeURIComponent(sessionId)}`);
}

export function renameConversation(sessionId: string, title: string) {
  return request(`/chat/${encodeURIComponent(sessionId)}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(sessionId: string) {
  return request(`/chat/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export function fetchGuidanceProfile(): Promise<{
  profil: GuidanceProfile;
  manquantes: string[];
}> {
  return request("/profil");
}

export function patchGuidanceProfile(
  values: Partial<GuidanceProfile>,
): Promise<{ profil: GuidanceProfile; manquantes: string[] }> {
  return request("/profil", { method: "PATCH", body: JSON.stringify(values) });
}

export function clearGuidanceProfileField(
  field: string,
): Promise<{ profil: GuidanceProfile; manquantes: string[] }> {
  return request(`/profil/${encodeURIComponent(field)}`, { method: "DELETE" });
}

export function saveRoadmapState(sessionId: string, checked: Record<string, boolean>) {
  return request(`/roadmap/state/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({ checked }),
  });
}

/** Feuille de route persistée + cases cochées — pour rouvrir la progression depuis un autre écran. */
export function fetchRoadmapState(sessionId: string): Promise<{
  session_id: string;
  roadmap: Record<string, any> | null;
  checked: Record<string, boolean>;
}> {
  return request(`/roadmap/state/${encodeURIComponent(sessionId)}`);
}

/** Télécharge le PDF de la feuille de route affichée (identique à l'écran). */
export async function downloadRoadmapPdf(sessionId: string | null, profil?: GuidanceProfile) {
  const response = await fetch(`${BASE}/roadmap/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId, profil: profil ?? null }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "feuille_de_route_ledgermind.pdf";
  link.click();
  URL.revokeObjectURL(url);
}
