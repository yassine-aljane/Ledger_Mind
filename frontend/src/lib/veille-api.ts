// Client de la veille fiscale personnalisée (`/api/veille/*`).
//
// Remplace `fetchVeille()` de `echeancier-api.ts`, qui lisait un rapport en mémoire filtré par
// simples étiquettes d'activité et exigeait un SIREN vérifié.
//
// À ne pas confondre avec `/api/guidance/veille/*` : celle-ci rafraîchit le corpus RAG derrière
// l'agent pédagogue. Les deux coexistent volontairement.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";
const BASE = `${API_BASE}/api/veille`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401) clearAuth();
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** Ce qui contraint passe devant ce qui informe — l'ordre du fil suit cette échelle. */
export type ImpactVeille = "information" | "action_recommandee" | "action_obligatoire";

export type SourceVeille = {
  libelle: string;
  url: string;
  date_publication: string | null;
  /** 1 = texte opposable · 2 = source administrative · 3 = presse (jamais seule). */
  autorite: 1 | 2 | 3;
};

export type Nouveaute = {
  id: string;
  titre: string;
  resume: string;
  impact: ImpactVeille;
  echeance: string | null;
  sources: SourceVeille[];
  date_collecte: string;
  date_verification: string;
  perime: boolean;
  /** Score de rattachement au profil, et sa justification en une phrase. */
  pertinence: number;
  pourquoi_vous: string;
  champs_profil_declencheurs: string[];
  notifiee: boolean;
  lue: boolean;
};

export type PreferencesVeille = {
  uid: string;
  active: boolean;
  mode: "tout" | "obligatoire_seulement";
  updated_at: string | null;
};

export type FilVeille = {
  nouveautes: Nouveaute[];
  preferences: PreferencesVeille;
};

/** `contexte: false` restreint aux nouveautés assez fortes pour avoir été notifiées. */
export function fetchFilVeille(contexte = true): Promise<FilVeille> {
  return request(`?contexte=${contexte}`);
}

export function fetchNotificationsVeille(nonLues = false): Promise<{
  notifications: Nouveaute[];
  non_lues: number;
}> {
  return request(`/notifications?non_lues=${nonLues}`);
}

export function marquerVeilleLue(nouveauteId: string) {
  return request<{ ok: boolean }>(`/notifications/${encodeURIComponent(nouveauteId)}/lue`, {
    method: "POST",
  });
}

export function marquerToutVeilleLu() {
  return request<{ marquees: number }>("/notifications/lues", { method: "POST" });
}

export function majPreferencesVeille(body: {
  active?: boolean;
  mode?: "tout" | "obligatoire_seulement";
}): Promise<PreferencesVeille> {
  return request("/preferences", { method: "PATCH", body: JSON.stringify(body) });
}
