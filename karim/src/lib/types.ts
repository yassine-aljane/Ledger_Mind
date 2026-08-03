/**
 * Types miroir des modèles Pydantic du backend FastAPI LedgerMind.
 * Aucune logique métier ici : uniquement le contrat.
 */

export type SubscriptionTier = "free" | "premium";

export interface BranchAgentContext {
  last_session_id?: string | null;
  phase?: string | null;
  updated_at?: string | null;
  completeness?: number | null;
  recommended_regime?: string | null;
  profile?: Record<string, unknown> | null;
  diagnostic_profile?: DiagnosticProfile | null;
  roadmap?: Roadmap | null;
}

export interface CaptureAgentContext {
  last_thread_id?: string | null;
  last_document_id?: string | null;
  updated_at?: string | null;
  history?: Record<string, unknown>[];
}

export interface ReferralAgentContext {
  history?: Record<string, unknown>[];
}

export interface AgentContext {
  intake: BranchAgentContext;
  guidance: BranchAgentContext;
  capture: CaptureAgentContext;
  referral: ReferralAgentContext;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  created_at?: string | null;
  agent_context?: AgentContext;
  /** Client-only (static freemium) — absent from backend UserPublic. */
  subscription_tier?: SubscriptionTier;
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type?: string;
  user: UserPublic;
}

/* ---------------- Éducation ---------------- */

export interface EducationSource {
  source?: string | null;
  titre?: string | null;
  url?: string | null;
  date_publication?: string | null;
  score?: number | null;
  perime?: boolean | null;
}

export interface EducationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EducationAnswer {
  answer: string;
  sources: EducationSource[];
  freshness_warning: boolean;
  corpus_empty: boolean;
  bofip_live_used: boolean;
  conversation_id?: string | null;
  regime_verdict?: string | null;
}

export interface EducationConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  type: string;
}

export interface EducationConversation {
  id: string;
  title: string;
  messages: {
    role: string;
    content: string;
    sources?: EducationSource[];
    created_at?: string;
  }[];
}

export interface RagStatus {
  corpus_chunks: number;
}

/* ---------------- Orchestrateur ---------------- */

export type UiAction =
  | "show_verification_result"
  | "ask_question"
  | "upload_registry_document"
  | "upload_sirene_document"
  | "show_tax_result"
  | "show_compliance"
  | "show_roadmap"
  | "done"
  | "requires_expert"
  | (string & {});

export interface DiagnosticProfile {
  activite?: string | null;
  ca_estime_annuel?: number | null;
  vend_produits?: boolean | null;
  recoit_cadeaux?: boolean | null;
  type_activite?: string | null;
  premiere_annee?: boolean | null;
  jours_activite?: number | null;
  anciennete?: string | null;
  ca_n_1_au_dessus_seuil?: boolean | null;
  ca_n_2_au_dessus_seuil?: boolean | null;
  situation_actuelle?: string | null;
  ca_prestations?: number | null;
  ca_vente?: number | null;
  choix_parcours?: "micro" | "societe" | string | null;
}

export interface OrchestratorOptions {
  kind: string;
  prompt: string;
  choices: { label: string; value: string }[];
}

export interface OrchestratorResponse {
  session_id: string;
  phase?: string;
  ui_action: UiAction;
  message?: string | null;
  quick_replies?: string[] | null;
  profile?: Record<string, unknown> | null;
  profile_completeness?: number | null;
  roadmap?: Roadmap | null;
  diagnostic_profile?: DiagnosticProfile | null;
  options?: OrchestratorOptions | null;
  roadmap_checked?: Record<string, boolean> | null;
  branch?: string | null;
  title?: string | null;
  [key: string]: unknown;
}

export interface SessionDetail {
  session_id: string;
  phase: string;
  branch: string;
  user_id?: string | null;
  profile: Record<string, unknown>;
  diagnostic_profile?: DiagnosticProfile | null;
  roadmap?: Roadmap | null;
  roadmap_checked?: Record<string, boolean>;
  options?: OrchestratorOptions | null;
  title?: string | null;
}

export interface SessionSummary {
  session_id: string;
  branch?: string | null;
  phase?: string | null;
  updated_at?: string | null;
  title?: string | null;
}

export interface RoadmapEtape {
  id?: string;
  titre?: string;
  detail?: string;
  description?: string;
  lien?: string;
  obligatoire?: boolean;
  duree?: string;
  cout?: string;
  phase?: string;
  parcours?: string;
  echeance?: string;
  priorite?: string;
  [key: string]: unknown;
}

export interface Roadmap {
  bandeau?: { type?: string; titre?: string; texte?: string } | null;
  analyse_juridique?: Record<string, unknown> | null;
  regime_recommande?: string | null;
  categorie?: string | null;
  durabilite?: string | null;
  parcours?: string | null;
  choix_fait?: boolean | null;
  seuils_profil?: Array<Record<string, unknown>> | null;
  etapes?: RoadmapEtape[] | null;
  phases?: Array<Record<string, unknown>> | null;
  etapes_parcours?: Array<Record<string, unknown>> | null;
  scenarios?: Array<Record<string, unknown>> | null;
  projections?: Record<string, unknown> | null;
  comparatif?: Record<string, unknown> | null;
  mixte?: Record<string, unknown> | null;
  prorata?: Record<string, unknown> | null;
  legal_sources?: Array<Record<string, unknown> | string> | null;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/* ---------------- Vérification ---------------- */

export interface OcrSiretResult {
  siret?: string | null;
  [key: string]: unknown;
}

export interface RegistryDocUploadResult {
  ok: boolean;
  document_type: "kbis" | "rne_extract";
  rcs_registered: boolean;
  registry_tax_base: "BIC" | "BNC";
  siren?: string | null;
  confidence?: string;
}

export interface SireneAvisUploadResult {
  ok: boolean;
  activity_label?: string | null;
  address?: string | null;
  registration_date?: string | null;
  siren?: string | null;
}

/* ---------------- Capture ---------------- */

export interface InvoiceLineItem {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
}

export interface Invoice {
  invoice_number?: string | null;
  issuer_name?: string | null;
  issuer_tax_id?: string | null;
  client_name?: string | null;
  issue_date?: string | null;
  line_items?: InvoiceLineItem[] | null;
  subtotal_ht?: number | null;
  vat_amount?: number | null;
  total_ttc?: number | null;
  currency?: string | null;
  paid?: boolean | null;
  due_date?: string | null;
  payment_terms_days?: number | null;
  expense_category?: string | null;
  incoherences?: string[] | null;
  payment_date?: string | null;
  payment_days_until?: number | null;
  saved?: boolean | null;
  duplicate_skipped?: boolean | null;
  [key: string]: unknown;
}

export interface BankTransfer {
  transfer_reference?: string | null;
  execution_date?: string | null;
  value_date?: string | null;
  amount?: number | null;
  currency?: string | null;
  direction?: string | null;
  sender_name?: string | null;
  receiver_name?: string | null;
  beneficiary_name?: string | null;
  sender_iban?: string | null;
  receiver_iban?: string | null;
  beneficiary_iban?: string | null;
  bic?: string | null;
  beneficiary_bic?: string | null;
  bank_name?: string | null;
  motif?: string | null;
  transfer_type?: string | null;
  [key: string]: unknown;
}

export type CaptureStatus = "completed" | "en_attente_utilisateur" | "erreur" | (string & {});

export interface CapturePending {
  type?: "champ_manquant" | "doublon" | (string & {});
  question?: string | null;
  field?: string | null;
  suggestions?: string[] | null;
  existing_invoice?: Invoice | null;
  new_invoice?: Invoice | null;
  [key: string]: unknown;
}

export interface CaptureResult {
  status: CaptureStatus;
  thread_id?: string | null;
  document_id?: string | null;
  document_type?: string | null;
  invoice?: Invoice | null;
  /** Backend field name is `transfer`, not bank_transfer. */
  transfer?: BankTransfer | null;
  pending?: CapturePending | null;
  analysis?: string | Record<string, unknown> | null;
  expense_category?: string | null;
  incoherences?: string[] | null;
  paid?: boolean | null;
  payment_date?: string | null;
  payment_days_until?: number | null;
  saved?: boolean | null;
  duplicate_skipped?: boolean | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface CaptureAnswerResponse {
  status: CaptureStatus;
  thread_id: string;
  document_id?: string | null;
  analyze?: CaptureResult | null;
  answer?: string | null;
  error?: string | null;
}

export interface CaptureQaAnswer {
  status?: string;
  document_id?: string;
  answer?: string;
  error?: string;
}

export interface InvoiceListItem {
  document_id: string;
  invoice: Invoice;
  analysis?: string | null;
  expense_category?: string | null;
  incoherences?: string[] | null;
  paid?: boolean | null;
  payment_date?: string | null;
  payment_days_until?: number | null;
  created_at?: string | null;
}

export interface VirementListItem {
  document_id: string;
  transfer: BankTransfer;
  analysis?: string | null;
  incoherences?: string[] | null;
  created_at?: string | null;
}

/* ---------------- Mise en relation ---------------- */

export interface ReferralEmail {
  destinataire: string;
  email?: string | null;
  objet: string;
  corps: string;
  statut?: string | null;
}

export interface ReferralResult {
  status?: string | null;
  error?: string | null;
  emails: ReferralEmail[];
  cabinets_count?: number | null;
}

export interface ReferralHistoryItem {
  ville?: string | null;
  demande?: string | null;
  created_at?: string | null;
  cabinets_count?: number | null;
  status?: string | null;
  emails?: ReferralEmail[] | null;
}
