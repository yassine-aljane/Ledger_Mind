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
  remise_pourcent?: number;
};

export type MentionFacture = { cle: string; libelle: string; valeur: string; source: string };

/**
 * Cycle de vie d'un document de facturation.
 *
 * `brouillon` n'a AUCUNE existence fiscale : il ne porte pas de numéro, et n'en consomme
 * pas — c'est ce qui garantit qu'un abandon ne laisse pas de trou dans la séquence, ce que
 * la loi interdit. L'émission attribue le numéro et fige le document.
 */
export type StatutFacture =
  | "brouillon"
  | "emise"
  | "partiellement_payee"
  | "payee"
  | "annulee";

export type TemplateFactureId = "minimal" | "grid" | "azure" | "mint" | "lilac";

export type ClientFacture = {
  nom: string;
  est_professionnel: boolean;
  adresse?: string | null;
  siret?: string | null;
  numero_tva_intracom?: string | null;
};

export type Acompte = {
  montant_ttc: number;
  facture_numero?: string | null;
  date_versement?: string | null;
};

export type Facture = {
  id: string;
  numero: string | null;          // `null` tant que le document est un brouillon
  type_document: "facture" | "avoir";
  statut: StatutFacture;
  date_emission: string | null;
  date_prestation: string;
  emetteur_nom: string;
  emetteur_siren: string;
  emetteur_franchise_tva: boolean;
  client: ClientFacture;
  lignes: LigneFacture[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  acompte?: Acompte | null;
  net_a_payer: number;
  montant_regle: number;
  tva_intracom_requise: boolean;
  date_echeance?: string | null;
  delai_paiement_jours?: number | null;
  mode_paiement?: string | null;
  numero_contrat?: string | null;
  numero_bon_commande?: string | null;
  facture_origine_numero?: string | null;   // rempli sur un avoir
  avoir_numero?: string | null;             // rempli sur la facture annulée
  mentions: MentionFacture[];
  template_id: TemplateFactureId;
  template_source: string;
};

export type FacturePayload = {
  client: ClientFacture;
  lignes: LigneFacture[];
  template_id: TemplateFactureId;
  date_prestation?: string | null;
  numero_contrat?: string | null;
  numero_bon_commande?: string | null;
  delai_paiement_jours?: number | null;
  date_echeance?: string | null;
  mode_paiement?: string | null;
  acompte?: Acompte | null;
};

/** Réponse des endpoints de brouillon : le document, et les mentions légales encore absentes. */
export type ReponseBrouillon = { facture: Facture; champs_manquants: string[] };

/** Émission directe, sans passer par un brouillon (voie historique). */
export function creerFacture(payload: FacturePayload): Promise<Facture> {
  return request("/api/facture", { method: "POST", body: JSON.stringify(payload) });
}

export function creerBrouillon(payload: FacturePayload): Promise<ReponseBrouillon> {
  return request("/api/facture/brouillon", { method: "POST", body: JSON.stringify(payload) });
}

export function modifierBrouillon(
  factureId: string,
  payload: FacturePayload,
): Promise<ReponseBrouillon> {
  return request(`/api/facture/brouillon/${encodeURIComponent(factureId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function supprimerBrouillon(factureId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/facture/brouillon/${encodeURIComponent(factureId)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!response.ok) throw new Error(await parseError(response));
}

export type ResultatSuppression = {
  supprime: boolean;
  numero: string | null;
  statut: StatutFacture;
  /** Vrai quand le numéro retiré a été consigné pour justifier le trou de séquence. */
  trace_conservee: boolean;
};

/**
 * Supprime un document de la liste ET de la base.
 *
 * Un brouillon part sans condition. Une facture ÉMISE exige `confirmerEmise` : la supprimer
 * laisse un trou dans la numérotation, ce que la réglementation interdit, et prive le rapport
 * fiscal de la pièce à laquelle un encaissement se rattache.
 */
export async function supprimerFacture(
  factureId: string,
  confirmerEmise = false,
): Promise<ResultatSuppression> {
  const query = confirmerEmise ? "?confirmer_suppression_emise=true" : "";
  return request(`/api/facture/${encodeURIComponent(factureId)}${query}`, { method: "DELETE" });
}

/** Numéros retirés de la séquence — de quoi justifier chaque trou lors d'un contrôle. */
export function listerSuppressions(): Promise<{
  suppressions: {
    numero: string | null;
    statut: string;
    client: string | null;
    date_emission: string | null;
    net_a_payer: number | null;
    supprime_le: string;
  }[];
}> {
  return request("/api/facture/suppressions");
}

/** Attribue le numéro de séquence et fige le document : il devient immuable. */
export function emettreFacture(factureId: string): Promise<Facture> {
  return request(`/api/facture/${encodeURIComponent(factureId)}/emettre`, { method: "POST" });
}

/** Annule une facture émise par un avoir. L'originale reste archivée, jamais supprimée. */
export function creerAvoir(
  factureId: string,
  payload: FacturePayload,
): Promise<{ avoir: Facture; facture_origine: Facture }> {
  return request(`/api/facture/${encodeURIComponent(factureId)}/avoir`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function enregistrerReglement(factureId: string, montant: number): Promise<Facture> {
  return request(`/api/facture/${encodeURIComponent(factureId)}/reglement`, {
    method: "POST",
    body: JSON.stringify({ montant }),
  });
}

export type AlerteTva = {
  ca_facture_ht: number;
  categorie: string;
  alerte: {
    niveau: "proche" | "depasse_base" | "depasse_majore";
    message: string;
    seuil_base: number;
    seuil_majore: number | null;
    note: string;
  } | null;
  provenance: Record<string, unknown>;
};

export function alerteTva(): Promise<AlerteTva> {
  return request("/api/facture/alerte-tva");
}

/** Information de profil qui manque à la facture, et ce que son absence coûte. */
export type ChampProfilManquant = {
  champ: string;
  libelle: string;
  consequence: string;
};

/**
 * Ce que le profil impose à la facture. Le taux de TVA n'est PAS une préférence de saisie :
 * il découle du régime déclaré à l'onboarding. `franchise_tva === null` signifie que le
 * régime n'est pas qualifié — ni franchise, ni assujetti — et qu'il faut le demander.
 */
export type ContexteFacturation = {
  franchise_tva: boolean | null;
  /** 0 sous franchise ; `null` si assujetti (le taux dépend alors de la prestation). */
  taux_tva_impose: number | null;
  mention_tva: string | null;
  denomination: string | null;
  siren: string | null;
  regime: string | null;
  delai_paiement_defaut: number;
  seuil_dispense_tva_intracom: number;
  champs_profil_manquants: ChampProfilManquant[];
  provenance: Record<string, unknown>;
};

export function contexteFacturation(): Promise<ContexteFacturation> {
  return request("/api/facture/contexte");
}

export function listerFactures(emisesSeulement = false): Promise<{ factures: Facture[] }> {
  return request(`/api/facture${emisesSeulement ? "?emises_seulement=true" : ""}`);
}

export function telechargerFacturePdf(factureId: string, numero: string | null): Promise<void> {
  return downloadPdf(
    `/api/facture/${encodeURIComponent(factureId)}/pdf`,
    `facture_${numero ?? "brouillon"}.pdf`,
  );
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
