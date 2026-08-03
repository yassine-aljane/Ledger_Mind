// Client de l'espace immatriculé « activité » : facture, rapport, déclaration, expert-comptable.
// Même base d'URL et même authentification que api.ts / guidance-api.ts.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) clearAuth();
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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

async function downloadPdf(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await parseError(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------------- Facture

export type LigneFacture = {
  designation: string;
  quantite: number;
  prix_unitaire_ht: number;
  taux_tva: number;
  categorie: "prestation" | "vente";
};

export type MentionFacture = { cle: string; libelle: string; valeur: string; source: string };

export type Facture = {
  id: string;
  numero: string;
  date_emission: string;
  date_prestation: string;
  emetteur_nom: string;
  emetteur_siren: string;
  client: { nom: string; est_professionnel: boolean; adresse?: string | null; numero_tva_intracom?: string | null };
  lignes: LigneFacture[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  tva_intracom_requise: boolean;
  mentions: MentionFacture[];
  template_source: string;
};

export function creerFacture(payload: {
  client: { nom: string; est_professionnel: boolean; adresse?: string; numero_tva_intracom?: string };
  lignes: LigneFacture[];
}): Promise<Facture> {
  return request("/api/facture", { method: "POST", body: JSON.stringify(payload) });
}

export function listerFactures(): Promise<{ factures: Facture[] }> {
  return request("/api/facture");
}

export function telechargerFacturePdf(factureId: string, numero: string): Promise<void> {
  return downloadPdf(`/api/facture/${encodeURIComponent(factureId)}/pdf`, `facture_${numero}.pdf`);
}

// ---------------------------------------------------------------------------------- Rapport

export type ChiffreCle = { cle: string; libelle: string; valeur: string; source?: string | null };
export type SignalConformite = { label: string; question: string };

export type RapportActivite = {
  id: string;
  date_debut: string;
  date_fin: string;
  nb_factures: number;
  total_ht: number;
  total_ttc: number;
  ventilation_prestations_ht: number;
  ventilation_ventes_ht: number;
  categorie_fiscale: string;
  regime_recommande: string;
  position_vs_seuil_pct: number;
  cotisations_estimees: number;
  chiffres_cles: ChiffreCle[];
  signaux_conformite: SignalConformite[];
  appreciation: string;
  sources: string[];
};

export function genererRapport(
  dateDebut: string,
  dateFin: string,
  objectif?: string,
): Promise<RapportActivite> {
  const q = objectif ? `?objectif=${encodeURIComponent(objectif)}` : "";
  return request(`/api/rapport${q}`, {
    method: "POST",
    body: JSON.stringify({ date_debut: dateDebut, date_fin: dateFin }),
  });
}

export function listerRapports(): Promise<{ rapports: RapportActivite[] }> {
  return request("/api/rapport");
}

export function telechargerRapportPdf(rapportId: string, debut: string, fin: string): Promise<void> {
  return downloadPdf(`/api/rapport/${encodeURIComponent(rapportId)}/pdf`, `rapport_${debut}_${fin}.pdf`);
}

// ------------------------------------------------------------------------------- Déclaration

export type LigneDeclaration = {
  case: string;
  libelle: string;
  montant: number;
  provenance: string;
};

export type Declaration = {
  id: string;
  date_debut: string;
  date_fin: string;
  formulaire: string;
  regime: string;
  source_formulaire: string;
  lignes: LigneDeclaration[];
  total_ca_declare: number;
  cotisations_urssac_estimees: number;
  statut: "brouillon" | "revue" | "prete_signature";
  avertissement: string;
};

export function genererDeclaration(
  dateDebut: string,
  dateFin: string,
  rapportSourceId?: string,
): Promise<Declaration> {
  return request("/api/declaration", {
    method: "POST",
    body: JSON.stringify({
      date_debut: dateDebut, date_fin: dateFin, rapport_source_id: rapportSourceId ?? null,
    }),
  });
}

export function listerDeclarations(): Promise<{ declarations: Declaration[] }> {
  return request("/api/declaration");
}

export function marquerDeclarationRevue(declarationId: string): Promise<Declaration> {
  return request(`/api/declaration/${encodeURIComponent(declarationId)}/revue`, { method: "PATCH" });
}

export function telechargerDeclarationPdf(declarationId: string, debut: string, fin: string): Promise<void> {
  return downloadPdf(
    `/api/declaration/${encodeURIComponent(declarationId)}/pdf`,
    `declaration_${debut}_${fin}.pdf`,
  );
}

// ------------------------------------------------------------------------- Expert-comptable

export type CabinetComptable = {
  nom_cabinet: string;
  adresse?: string | null;
  telephone?: string | null;
  site_web?: string | null;
  email?: string | null;
  distance_km?: number | null;
  lat?: number | null;
  lon?: number | null;
  source: string;
};

export type RechercheExpertsComptables = {
  ville_recherchee: string;
  ville_lat?: number | null;
  ville_lon?: number | null;
  cabinets: CabinetComptable[];
  sources: string[];
  annuaire_officiel_url: string;
  annuaire_officiel_label: string;
  avertissement: string;
};

export function rechercherExpertsComptables(ville: string): Promise<RechercheExpertsComptables> {
  return request(`/api/expert-comptable?ville=${encodeURIComponent(ville)}`);
}
