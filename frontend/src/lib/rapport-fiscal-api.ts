// Client du rapport fiscal — assiette ENCAISSÉE, rapprochée facture par virement.
//
// Distinct de `/api/rapport` (rapport d'activité, fondé sur le CA facturé) : ici l'assiette
// est le chiffre d'affaires encaissé, seul chiffre déclarable pour une micro-entreprise.
//
// Aucun calcul fiscal n'est fait côté navigateur : tout vient du moteur d'impôt, y compris
// les montants et leur provenance. Le front n'est qu'un afficheur.

import { authHeaders, clearAuth } from "@/lib/auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) clearAuth();
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`;
}

export type MethodeRapprochement = "numero_facture" | "montant_date" | "manuel";

export type LigneEncaissement = {
  virement_document_id: string;
  /** Montant réellement reçu, TVA comprise — celui du relevé bancaire. */
  montant: number;
  /** Part hors taxe : c'est ELLE qui constitue le chiffre d'affaires. La TVA collectée transite. */
  montant_ht: number;
  date_valeur: string | null;
  libelle: string | null;
  contrepartie: string | null;
  facture_numero: string | null;
  facture_id: string | null;
  methode: MethodeRapprochement;
  /** Faux quand le rattachement repose sur une simple concordance montant + date. */
  certain: boolean;
  categorie: "prestation" | "vente";
};

export type VirementNonRetenu = {
  virement_document_id: string;
  montant: number;
  date_valeur: string | null;
  libelle: string | null;
  contrepartie: string | null;
  motif: string;
  action_suggeree: string | null;
};

export type FactureNonSoldee = {
  numero: string | null;
  facture_id: string;
  client: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  net_a_payer: number;
  encaisse: number;
  reste_du: number;
  en_retard: boolean;
  jours_de_retard: number | null;
};

export type EcartRapprochement = {
  type: string;
  message: string;
  facture_numero: string | null;
  virement_document_id: string | null;
  ecart: number | null;
};

export type Rapprochement = {
  periode_debut: string;
  periode_fin: string;
  ca_encaisse: number;
  ca_encaisse_certain: number;
  encaissements: LigneEncaissement[];
  virements_non_retenus: VirementNonRetenu[];
  factures_impayees: FactureNonSoldee[];
  factures_partielles: FactureNonSoldee[];
  ecarts: EcartRapprochement[];
  ca_par_categorie: Record<string, number>;
  /** Écartés pour la SEULE raison de la période. Non comptés, mais jamais tus. */
  virements_hors_periode: {
    virement_document_id: string;
    date: string | null;
    montant: number;
    libelle: string | null;
    cite_une_facture: boolean;
  }[];
};

export type ContexteFiscalRapport = {
  parts_fiscales?: number | null;
  autres_revenus?: number | null;
  en_couple?: boolean;
  rfr_n2?: number | null;
  caisse_bnc?: "REGIME_GENERAL" | "CIPAV";
  acre_active?: boolean;
  option_versement_liberatoire?: boolean;
  jours_activite?: number | null;
  dom?: boolean;
  categorie_par_defaut?: "BIC_VENTE" | "BIC_SERVICE" | "BNC";
};

export type Alerte = {
  niveau: "info" | "vigilance" | "critique";
  titre: string;
  message: string;
  source?: string | null;
};

export type LigneTva = {
  nature: string;
  libelle: string;
  ca: number;
  seuil_base: number;
  seuil_majore: number | null;
  depasse_base: boolean;
  depasse_majore: boolean;
  reste_avant_base: number;
};

export type EtatTva = {
  lignes: LigneTva[];
  depasse_base: boolean;
  depasse_majore: boolean;
  /** État explicite : « conforme » est une information, pas une absence d'anomalie. */
  statut?: "franchise_conservee" | "seuil_base_depasse" | "seuil_majore_depasse";
  libelle_statut?: string;
  annee_seuils?: number;
  source?: string;
  date_verif?: string;
  note?: string;
  periode_annee_complete?: boolean;
};

/** État du plafond micro pour une catégorie — donné qu'il soit dépassé ou non. */
export type EtatPlafond = {
  categorie: string;
  ca: number;
  plafond: number;
  plafond_proratise: boolean;
  conforme: boolean;
  marge_restante: number;
};

export type ControlePlafonds = {
  plafonds: EtatPlafond[];
  au_dessus_du_plafond: boolean;
  jours_activite: number | null;
  note: string;
};

/** Constantes effectivement appliquées : le calcul doit être vérifiable, pas seulement plausible. */
export type ParametresCategorie = {
  categorie: string;
  caisse_bnc: string | null;
  taux_abattement: number;
  abattement_minimum: number;
  taux_social: number;
  taux_cfp: number;
  taux_versement_liberatoire: number;
  plafond_ca: number;
  plafond_proratise: boolean;
  acre: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type EtatAcre = {
  active: boolean;
  reduction: number;
  reduction_pourcent: number;
  duree_trimestres: number;
  date_debut: string | null;
  trimestres_restants: number | null;
  date_fin_estimee: string | null;
  expiree?: boolean;
  approximation?: string;
  source?: string;
  note?: string;
  hypothese?: string;
};

export type EtatProrata = {
  applique: boolean;
  jours_activite: number | null;
  date_creation: string | null;
  methode: string | null;
  plafonds_proratises: { categorie: string; plafond: number }[];
  note: string;
};

/** Sortie du moteur d'impôt, recopiée telle quelle. `null` = calcul non effectué, jamais 0. */
export type SimulationImpots = {
  ca_total: number;
  lignes: {
    categorie: string;
    ca: number;
    taux_abattement: number;
    abattement: number;
    base_imposable: number;
    plancher_applique: boolean;
  }[];
  base_imposable: number;
  ir_bareme: number | null;
  ir_bareme_calculable: boolean;
  versement_liberatoire: {
    eligible: boolean | null;
    motif_ineligibilite?: string | null;
    plafond_rfr: number | null;
    montant: number | null;
  };
  cotisations_sociales: number;
  cfp: number;
  acre_appliquee: boolean;
  ir_retenu: number | null;
  option_retenue: string | null;
  recommandation: string | null;
  total_prelevements: number | null;
  revenu_net_estime: number | null;
  taux_effectif: number | null;
  depassements: { categorie: string; ca: number; plafond: number; plafond_proratise?: boolean }[];
  avertissements: string[];
};

/** Contrat capturé dont la période recouvre celle du rapport. N'entre jamais dans le CA. */
export type ContratEnCours = {
  document_id: string;
  type: string | null;
  titre: string | null;
  contrepartie: string | null;
  date_debut: string | null;
  date_fin: string | null;
  montant_eur: number | null;
  echeancier: string | null;
  duree_indeterminee: boolean | null;
};

/** Dépense capturée. Informative : en micro, l'abattement remplace la déduction des frais. */
export type DepenseCapturee = {
  document_id: string;
  fournisseur: string | null;
  numero: string | null;
  date: string | null;
  montant_eur: number | null;
  categorie: string | null;
};

export type SourcesRapport = {
  factures_emises: number;
  virements_analyses: number;
  contrats_en_cours: number;
  depenses_capturees: number;
  profil_onboarding: boolean;
  contrats: ContratEnCours[];
  depenses: DepenseCapturee[];
  total_depenses_eur: number;
  revenu_contractuel_engage_eur: number;
};

export type RapportFiscal = {
  id: string;
  uid: string;
  date_debut: string;
  date_fin: string;
  genere_le: string;
  /** Assiette : le CA ENCAISSÉ. */
  ca_retenu: number;
  base_de_calcul: string;
  /** Indicateur d'écart, jamais assiette : facturer n'est pas encaisser. */
  ca_facture_periode: number;
  rapprochement: Rapprochement | null;
  sources: SourcesRapport;
  simulation: SimulationImpots | null;
  ir_calculable: boolean;
  tva: EtatTva;
  /** Catégories qui commandent abattement, cotisations, CFP, versement libératoire, plafond. */
  categories_fiscales: string[];
  plafonds: ControlePlafonds;
  parametres: ParametresCategorie[];
  acre: EtatAcre;
  prorata: EtatProrata;
  alertes: Alerte[];
  hypotheses: string[];
  provenance: Record<string, { fichier?: string; annee?: number; date_verif?: string; verifie?: boolean }>;
};

/** Ligne de la liste des rapports archivés — projection réduite côté serveur. */
export type RapportArchive = {
  id: string;
  date_debut: string;
  date_fin: string;
  genere_le: string;
  ca_retenu: number;
  ca_facture_periode: number;
  ir_calculable: boolean;
  simulation?: { total_prelevements?: number | null; base_imposable?: number | null } | null;
  alertes: Alerte[];
  sources: SourcesRapport;
};

/** D'où vient chaque valeur préremplie — distingue « jamais posé » de « je ne sais pas ». */
export type OrigineChamp = "onboarding" | "non_renseigne" | "sans_reponse";

export type ContextePrerempli = {
  contexte: ContexteFiscalRapport | null;
  origine: Record<string, OrigineChamp>;
  champs_bloquants: { champ: string; libelle: string; consequence: string }[];
  profil_disponible: boolean;
  denomination?: string | null;
  siren?: string | null;
  regime?: string | null;
};

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

/** Situation connue de l'onboarding, pour préremplir l'écran. L'utilisateur peut corriger. */
export function contextePrerempli(): Promise<ContextePrerempli> {
  return json("/api/rapport-fiscal/contexte");
}

export function genererRapportFiscal(
  dateDebut: string,
  dateFin: string,
  contexte: ContexteFiscalRapport = {},
): Promise<RapportFiscal> {
  return json("/api/rapport-fiscal", {
    method: "POST",
    body: JSON.stringify({ date_debut: dateDebut, date_fin: dateFin, contexte }),
  });
}

export function listerRapportsFiscaux(): Promise<{ rapports: RapportArchive[] }> {
  return json("/api/rapport-fiscal");
}

export function obtenirRapportFiscal(id: string): Promise<RapportFiscal> {
  return json(`/api/rapport-fiscal/${encodeURIComponent(id)}`);
}

export function supprimerRapportFiscal(id: string): Promise<{ supprime: boolean }> {
  return json(`/api/rapport-fiscal/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Télécharge le PDF d'un rapport ARCHIVÉ : les chiffres du jour de sa génération, pas ceux
 * d'aujourd'hui. Un rapport est une photo de la période.
 */
export async function telechargerRapportFiscalPdf(
  id: string,
  dateDebut: string,
  dateFin: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/rapport-fiscal/${encodeURIComponent(id)}/pdf`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(await parseError(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rapport-fiscal_${dateDebut}_${dateFin}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
