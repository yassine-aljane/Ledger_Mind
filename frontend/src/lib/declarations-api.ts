// Client de l'agent déclaratif — brouillons prêts à recopier, jamais transmis.
//
// Il n'existe volontairement AUCUN appel de transmission : la validation et l'envoi sur le
// site officiel restent des gestes humains. Aucun montant n'est calculé ici non plus — tout
// vient du moteur d'impôt, côté serveur.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) clearAuth();
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export type TypeDeclaration = "ca_urssaf" | "des" | "tva_ca3" | "revenus_2042" | "cfe";
export type Frequence = "mensuelle" | "trimestrielle" | "annuelle";
/** Une référence de case non recoupée ne doit jamais se présenter comme certaine. */
export type Fiabilite = "confirmee" | "a_verifier";
export type Priorite = "haute" | "normale" | "info";

export type ChampBrouillon = {
  case: string | null;
  libelle: string;
  valeur: number | string | boolean | null;
  unite: string | null;
  provenance: string;
  pieces_ids: string[];
  fiabilite: Fiabilite;
  note: string | null;
};

export type Brouillon = {
  type: TypeDeclaration;
  titre: string;
  formulaire: string | null;
  cerfa: string | null;
  teleservice: string | null;
  lien: string | null;
  periode_debut: string;
  periode_fin: string;
  frequence: Frequence;
  echeance: string | null;
  champs: ChampBrouillon[];
  /** `null` = déclaration informative (DES) ou montant non calculable ici (CFE). */
  montant_a_payer: number | null;
  applicable: boolean;
  motif_non_applicable: string | null;
  points_de_vigilance: string[];
  provenance: Record<string, unknown>;
};

export type Rappel = {
  declaration: TypeDeclaration;
  titre: string;
  priorite: Priorite;
  echeance: string | null;
  message: string;
  lien: string | null;
};

export type RevenuUE = {
  virement_document_id: string;
  date: string | null;
  montant_eur: number;
  contrepartie: string | null;
  pays: string | null;
  plateforme: string | null;
  /** Vrai quand le pays vient d'un IBAN ; faux quand il n'est déduit que d'un libellé. */
  certain: boolean;
  indice: string | null;
};

export type ContexteDeclaratif = {
  frequence?: Frequence;
  categorie_par_defaut?: "BIC_VENTE" | "BIC_SERVICE" | "BNC";
  caisse_bnc?: "REGIME_GENERAL" | "CIPAV";
  acre_active?: boolean;
  option_versement_liberatoire?: boolean;
  assujetti_tva?: boolean;
  numero_tva_intracom?: string | null;
  date_creation?: string | null;
  departement?: string | null;
  ca_annuel_cumule?: number | null;
};

export type Prelevements = {
  postes: {
    categorie: string;
    ca: number;
    cotisations_sociales: number;
    taux_cotisations: number;
    cfp: number;
    taux_cfp: number;
    cfp_exoneree: boolean;
    tfcc: number;
    taux_tfcc: number;
    tfcc_applicable: boolean;
    versement_liberatoire?: number;
    taux_versement_liberatoire?: number;
  }[];
  ca_total: number;
  cotisations_sociales: number;
  cfp: number;
  tfcc: number;
  cfp_exoneree: boolean;
  seuil_cfp_premiere_annee: number;
  acre_appliquee: boolean;
  total_a_payer: number;
  versement_liberatoire?: number;
};

export type JeuDeclarations = {
  id: string;
  uid: string;
  date_debut: string;
  date_fin: string;
  genere_le: string;
  frequence: Frequence;
  ca_encaisse: number;
  ca_par_categorie: Record<string, number>;
  brouillons: Brouillon[];
  rappels: Rappel[];
  revenus_ue: RevenuUE[];
  prelevements: Prelevements;
  /** TVA chiffrée depuis les pièces : collectée sur les factures émises, déductible sur les
   *  factures reçues. Les MONTANTS sont sûrs ; les numéros de case, non. */
  tva_collectee: {
    lignes: { numero: string | null; date: string | null; client: string | null;
              base_ht: number; tva: number }[];
    total: number;
    base_ht: number;
  };
  tva_deductible: {
    lignes: { fournisseur: string | null; numero: string | null; date: string | null;
              base_ht: number | null; tva: number | null }[];
    total: number;
    pieces_sans_tva_lue: number;
    reserve: string;
  };
  /** Contrats en cours — contexte de cohérence, jamais une case de formulaire. */
  contrats_actifs: { document_id: string; type: string | null; titre: string | null;
                     contrepartie: string | null; montant_eur: number | null }[];
  /** Écart avec un rapport fiscal portant exactement la même période. */
  recoupement_rapport: {
    rapport_id: string; genere_le: string; ca_du_rapport: number;
    ca_declare: number; ecart: number; concordant: boolean;
  } | null;
  avertissement: string;
  hypotheses: string[];
  provenance: Record<string, Record<string, unknown>>;
};

export type JeuArchive = {
  id: string;
  date_debut: string;
  date_fin: string;
  genere_le: string;
  frequence: Frequence;
  ca_encaisse: number;
  rappels: Rappel[];
  prelevements?: { total_a_payer?: number } | null;
};

export type ContextePreremplí = {
  contexte: ContexteDeclaratif | null;
  informations_manquantes: { champ: string; libelle: string; consequence: string }[];
  profil_disponible: boolean;
  denomination?: string | null;
  siren?: string | null;
};

export type StatutEcheance = "periode_en_cours" | "a_faire" | "en_retard";

/**
 * Une déclaration due sur une période IMPOSÉE par la réglementation et par la périodicité
 * déclarée à la création — jamais choisie dans l'écran.
 */
export type Echeance = {
  type: TypeDeclaration;
  libelle: string;
  periode_debut: string;
  periode_fin: string;
  libelle_periode: string;
  frequence: Frequence;
  /** `date_limite` OU `fenetre_indicative` : une fenêtre officielle n'est jamais transformée
   *  en date précise, ce serait inventer une échéance. */
  date_limite: string | null;
  fenetre_indicative: string | null;
  obligatoire_meme_a_zero: boolean;
  note: string | null;
  conditions: string[];
  statut: StatutEcheance;
  /** CA encaissé de CETTE période — sans lui, un 0 € est indiscernable d'une panne. */
  ca_encaisse: number;
};

export type Calendrier = {
  annee: number;
  aujourdhui: string;
  frequence: Frequence;
  frequence_source: string;
  ca_annuel_encaisse: number;
  echeances: Echeance[];
  prochaine: Echeance | null;
};

/** Situation déclarative connue de l'onboarding. Préremplissage : l'utilisateur corrige. */
export function contexteDeclaratif(): Promise<ContextePreremplí> {
  return json("/api/declarations/contexte");
}

/** Calendrier des déclarations dues. La périodicité vient du profil, pas de l'écran. */
export function calendrierDeclarations(annee?: number): Promise<Calendrier> {
  return json(`/api/declarations/echeances${annee ? `?annee=${annee}` : ""}`);
}

/** Produit les documents d'UNE échéance : ses bornes viennent du calendrier. */
export function genererDeclarations(
  dateDebut: string,
  dateFin: string,
  contexte: ContexteDeclaratif = {},
  typeDeclaration?: TypeDeclaration,
): Promise<JeuDeclarations> {
  return json("/api/declarations", {
    method: "POST",
    body: JSON.stringify({
      date_debut: dateDebut,
      date_fin: dateFin,
      type_declaration: typeDeclaration ?? null,
      contexte,
    }),
  });
}

async function telecharger(chemin: string, nom: string): Promise<void> {
  const response = await fetch(`${API_BASE}${chemin}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await parseError(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

/** Dossier complet, prêt pour le visa de l'expert-comptable. */
export function telechargerDossier(id: string, debut: string, fin: string): Promise<void> {
  return telecharger(
    `/api/declarations/${encodeURIComponent(id)}/dossier.pdf`,
    `declarations_${debut}_${fin}.pdf`,
  );
}

/** UNE déclaration, en document signable. */
export function telechargerDocument(
  id: string,
  type: TypeDeclaration,
  debut: string,
  fin: string,
): Promise<void> {
  return telecharger(
    `/api/declarations/${encodeURIComponent(id)}/${type}.pdf`,
    `${type}_${debut}_${fin}.pdf`,
  );
}

export function listerJeuxDeclarations(): Promise<{ jeux: JeuArchive[] }> {
  return json("/api/declarations");
}

export function obtenirJeuDeclarations(id: string): Promise<JeuDeclarations> {
  return json(`/api/declarations/${encodeURIComponent(id)}`);
}

export function supprimerJeuDeclarations(id: string): Promise<{ supprime: boolean }> {
  return json(`/api/declarations/${encodeURIComponent(id)}`, { method: "DELETE" });
}
