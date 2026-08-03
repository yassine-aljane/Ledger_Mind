// Client du Centre d'Actions : agenda fiscal, confirmation de paiement, historique.
// Même base d'URL et même authentification que api.ts / guidance-api.ts / facturation-api.ts.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";
const BASE = `${API_BASE}/api/echeancier`;

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
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<T>;
}

export type StatutEcheance = "a_venir" | "urgent" | "en_retard" | "regularisee";

export type Echeance = {
  id: string;
  obligation_id: string;
  libelle: string;
  periode: string;
  date_limite: string | null;
  fenetre_indicative: string | null;
  statut: StatutEcheance;
  palier_alerte: string | null;
  portail_paiement: string;
  portail_label: string;
  source: string;
  regularisee_le: string | null;
};

export type AgendaResponse = {
  echeances: Echeance[];
  parametres_manquants: string[];
};

export type ParametresCalendrier = {
  periodicite_urssaf?: "mensuelle" | "trimestrielle";
  regime_tva?: "franchise" | "reel_simplifie" | "reel_normal";
  numero_tva_intracommunautaire?: string;
  revenus_intracommunautaires?: boolean;
  versement_liberatoire?: boolean;
};

export type HistoriqueItem = {
  type: "facture" | "rapport" | "declaration" | "echeance";
  id: string;
  libelle: string;
  date: string;
  statut: string;
  montant: number | null;
};

export function fetchAgenda(): Promise<AgendaResponse> {
  return request("/agenda");
}

export function mettreAJourParametres(
  valeurs: ParametresCalendrier,
): Promise<{ parametres_manquants: string[] }> {
  return request("/parametres", { method: "PATCH", body: JSON.stringify(valeurs) });
}

export function marquerPaye(obligationId: string, periode: string): Promise<{ statut: string }> {
  return request(`/${encodeURIComponent(obligationId)}/marquer-paye`, {
    method: "POST",
    body: JSON.stringify({ periode }),
  });
}

export function fetchHistorique(): Promise<HistoriqueItem[]> {
  return request("/historique");
}

