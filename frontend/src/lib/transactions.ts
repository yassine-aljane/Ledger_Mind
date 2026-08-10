/**
 * Flux unifié des transactions.
 *
 * Cinq sources décrivent le même objet du point de vue de l'utilisateur — de l'argent
 * qui entre ou qui sort — avec cinq schémas différents. Ce module les ramène à une
 * forme unique, `TransactionUnifiee`, pour que l'écran Transactions n'ait plus à
 * connaître la structure de chaque agent.
 *
 * Deux règles tenues partout ici :
 *
 * 1. Tous les champs venant de l'API sont `Optional` côté Pydantic. Une donnée absente
 *    est la normale, pas une exception : chaque accès passe par `texte`/`nombre`/`liste`
 *    et retombe sur `null`. Rien dans ce module ne doit pouvoir lever.
 * 2. Un contrat engage, il ne déplace pas d'argent. Il apparaît dans la liste comme
 *    contexte (`est_flux: false`) mais n'entre jamais dans les totaux — sans quoi un
 *    budget de sponsoring annuel serait compté comme un encaissement du mois.
 */

import {
  libelleCadeau,
  type CaptureCadeauItem,
  type CaptureContratItem,
  type CaptureInvoiceItem,
  type CaptureVirementItem,
} from "@/lib/api";
import type { Facture, StatutFacture } from "@/lib/facturation-api";

// ------------------------------------------------------------------------------- Types

export type SensFlux = "entrant" | "sortant";

export type SourceTransaction =
  | "facture_emise"
  | "facture_recue"
  | "virement"
  | "cadeau"
  | "contrat";

/** Tons disponibles sur `Badge` — le tableau les passe tels quels en `variant`. */
export type TonStatut = "success" | "warning" | "info" | "outline" | "destructive";

export type StatutTransaction = { libelle: string; ton: TonStatut };

export type TransactionUnifiee = {
  /** Unique tous types confondus : deux sources peuvent porter le même identifiant. */
  id: string;
  date: string | null;
  sens: SensFlux;
  libelle: string;
  contrepartie: string | null;
  reference: string | null;
  montant_ht: number | null;
  montant_net: number | null;
  statut: StatutTransaction;
  source: SourceTransaction;
  /** L'explication rédigée par l'agent lors de la capture. */
  analysis: string | null;
  incoherences: string[];
  expense_category: string | null;
  has_file: boolean;
  /** Pièce capturée. `null` sur une facture émise : son PDF est régénéré à la demande. */
  document_id: string | null;
  /** Facture émise sans pièce capturée : le PDF se télécharge par `telechargerFacturePdf`. */
  facture_id: string | null;
  est_flux: boolean;
};

export const SOURCE_LIBELLE: Record<SourceTransaction, string> = {
  facture_emise: "Facture émise",
  facture_recue: "Facture reçue",
  virement: "Virement",
  cadeau: "Cadeau",
  contrat: "Contrat",
};

// --------------------------------------------------------------------------- Garde-fous

function texte(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

function nombre(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function liste(v: string[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((i): i is string => typeof i === "string" && i.trim() !== "");
}

/** Première date réellement parsable parmi les candidates. `null` si aucune. */
function premiereDate(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const brut = texte(candidate);
    if (brut && !Number.isNaN(new Date(brut).getTime())) return brut;
  }
  return null;
}

/** « 14 nov. 2026 ». Rend `—` sur une date absente ou illisible, jamais une exception. */
export function formatDateCourte(iso: string | null | undefined): string {
  const brut = texte(iso);
  if (!brut) return "—";
  const d = new Date(brut);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------- Normalisations

const STATUT_FACTURE: Record<StatutFacture, StatutTransaction> = {
  brouillon: { libelle: "Brouillon", ton: "outline" },
  emise: { libelle: "Émise", ton: "info" },
  partiellement_payee: { libelle: "Partiellement payée", ton: "warning" },
  payee: { libelle: "Payée", ton: "success" },
  annulee: { libelle: "Annulée par avoir", ton: "destructive" },
};

const STATUT_INCONNU: StatutTransaction = { libelle: "Non précisé", ton: "outline" };

/** Facture émise par l'utilisateur : de l'argent qui rentre. Un avoir le rend. */
export function normaliserFactureEmise(f: Facture): TransactionUnifiee {
  const numero = texte(f.numero);
  const estAvoir = f.type_document === "avoir";
  const statut = (STATUT_FACTURE[f.statut] as StatutTransaction | undefined) ?? STATUT_INCONNU;

  return {
    id: `facture_emise:${f.id}`,
    date: premiereDate(f.date_emission, f.date_prestation),
    sens: estAvoir ? "sortant" : "entrant",
    libelle: estAvoir
      ? numero
        ? `Avoir ${numero}`
        : "Avoir"
      : numero
        ? `Facture ${numero}`
        : "Facture en brouillon",
    contrepartie: texte(f.client?.nom),
    reference: numero,
    montant_ht: nombre(f.total_ht),
    montant_net: nombre(f.net_a_payer) ?? nombre(f.total_ttc),
    statut,
    source: "facture_emise",
    analysis: null,
    incoherences: [],
    expense_category: null,
    // Le PDF d'une facture émise est régénéré à la demande ; un brouillon n'en a pas.
    has_file: f.statut !== "brouillon",
    document_id: null,
    facture_id: f.id,
    est_flux: true,
  };
}

/** Facture reçue d'un fournisseur : une dépense. */
export function normaliserFactureRecue(item: CaptureInvoiceItem): TransactionUnifiee {
  const facture = item.invoice ?? {};
  const numero = texte(facture.invoice_number);
  const paid = facture.paid ?? item.paid ?? null;

  const statut: StatutTransaction =
    paid === true
      ? { libelle: "Réglée", ton: "success" }
      : paid === false
        ? { libelle: "À régler", ton: "warning" }
        : STATUT_INCONNU;

  return {
    id: `facture_recue:${item.document_id}`,
    date: premiereDate(facture.issue_date, item.created_at),
    sens: "sortant",
    libelle: numero ? `Facture ${numero}` : "Facture reçue",
    contrepartie: texte(facture.issuer_name),
    reference: numero,
    montant_ht: nombre(facture.subtotal_ht),
    montant_net: nombre(facture.amount_eur) ?? nombre(facture.total_ttc),
    statut,
    source: "facture_recue",
    analysis: texte(item.analysis),
    incoherences: liste(item.incoherences),
    expense_category: texte(item.expense_category),
    has_file: item.has_file === true,
    document_id: item.document_id,
    facture_id: null,
    est_flux: true,
  };
}

/**
 * Virement bancaire. `direction` fait foi quand l'agent l'a extraite ; sinon le signe du
 * montant tranche, un débit étant stocké négatif.
 */
export function normaliserVirement(item: CaptureVirementItem): TransactionUnifiee {
  const virement = item.transfer ?? {};
  const direction = texte(virement.direction)?.toLowerCase() ?? null;
  const montant = nombre(virement.amount_eur) ?? nombre(virement.amount);

  const sens: SensFlux =
    direction === "recu" ? "entrant" : direction === "emis" ? "sortant" : (montant ?? 0) < 0 ? "sortant" : "entrant";

  const contrepartie =
    sens === "entrant" ? texte(virement.sender_name) : texte(virement.beneficiary_name);

  return {
    id: `virement:${item.document_id}`,
    date: premiereDate(virement.execution_date, virement.value_date, item.created_at),
    sens,
    libelle: texte(virement.motif) ?? (sens === "entrant" ? "Virement reçu" : "Virement émis"),
    contrepartie,
    reference: texte(virement.transfer_reference),
    // Un virement porte un montant unique : ni base HT ni TVA à en tirer.
    montant_ht: null,
    montant_net: montant === null ? null : Math.abs(montant),
    statut:
      sens === "entrant"
        ? { libelle: "Encaissé", ton: "success" }
        : { libelle: "Décaissé", ton: "info" },
    source: "virement",
    analysis: texte(item.analysis),
    incoherences: liste(item.incoherences),
    expense_category: null,
    has_file: item.has_file === true,
    document_id: item.document_id,
    facture_id: null,
    est_flux: true,
  };
}

/**
 * Cadeau reçu d'une marque. Fiscalement un revenu en nature : il entre au même titre
 * qu'un encaissement, à la valeur RETENUE (`valeur_ttc`) — jamais à l'estimation, qui
 * n'est qu'une suggestion tirée d'une photo.
 */
export function normaliserCadeau(item: CaptureCadeauItem): TransactionUnifiee {
  const cadeau = item.cadeau ?? {};
  const valeurRetenue = nombre(cadeau.valeur_eur) ?? nombre(cadeau.valeur_ttc);

  return {
    id: `cadeau:${item.document_id}`,
    date: premiereDate(cadeau.date_reception, item.created_at),
    sens: "entrant",
    libelle: libelleCadeau(cadeau),
    contrepartie: texte(cadeau.marque),
    reference: null,
    montant_ht: null,
    montant_net: valeurRetenue,
    statut:
      valeurRetenue === null
        ? { libelle: "À valoriser", ton: "warning" }
        : { libelle: "Valeur retenue", ton: "success" },
    source: "cadeau",
    analysis: texte(item.analysis),
    incoherences: liste(item.incoherences),
    expense_category: null,
    has_file: item.has_file === true,
    document_id: item.document_id,
    facture_id: null,
    est_flux: true,
  };
}

/**
 * Contrat. Présent pour le contexte — savoir qu'un encaissement se rattache à un
 * engagement signé — mais `est_flux: false` : sa contrepartie financière est un montant
 * global, pas un mouvement daté.
 */
export function normaliserContrat(item: CaptureContratItem): TransactionUnifiee {
  const contrat = item.contract ?? {};
  const parties = Array.isArray(contrat.parties) ? contrat.parties : [];
  const contrepartie = parties.map((p) => texte(p?.name)).find((nom) => nom !== null) ?? null;

  return {
    id: `contrat:${item.document_id}`,
    date: premiereDate(contrat.signature_date, contrat.start_date, item.created_at),
    sens: "entrant",
    libelle: texte(contrat.title) ?? texte(contrat.contract_type) ?? "Contrat",
    contrepartie,
    reference: texte(contrat.reference),
    montant_ht: null,
    montant_net: nombre(contrat.amount_eur) ?? nombre(contrat.amount),
    statut: { libelle: "Engagement", ton: "outline" },
    source: "contrat",
    analysis: texte(item.analysis),
    incoherences: liste(item.incoherences),
    expense_category: null,
    has_file: item.has_file === true,
    document_id: item.document_id,
    facture_id: null,
    est_flux: false,
  };
}

export type SourcesFlux = {
  facturesEmises?: Facture[] | null;
  facturesRecues?: CaptureInvoiceItem[] | null;
  virements?: CaptureVirementItem[] | null;
  cadeaux?: CaptureCadeauItem[] | null;
  contrats?: CaptureContratItem[] | null;
};

/**
 * Fusionne les sources disponibles, du plus récent au plus ancien. Une source absente
 * (échec de chargement) est simplement ignorée : les autres restent affichables.
 */
export function construireFluxUnifie(sources: SourcesFlux): TransactionUnifiee[] {
  const flux: TransactionUnifiee[] = [
    ...(sources.facturesEmises ?? []).map(normaliserFactureEmise),
    ...(sources.facturesRecues ?? []).map(normaliserFactureRecue),
    ...(sources.virements ?? []).map(normaliserVirement),
    ...(sources.cadeaux ?? []).map(normaliserCadeau),
    ...(sources.contrats ?? []).map(normaliserContrat),
  ];

  // Une transaction sans date exploitable ne peut pas être classée : elle passe en fin
  // de liste plutôt que d'être écartée — c'est justement celle qu'il faut compléter.
  return flux.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Number.NEGATIVE_INFINITY;
    const tb = b.date ? new Date(b.date).getTime() : Number.NEGATIVE_INFINITY;
    return tb - ta;
  });
}

// -------------------------------------------------------------------------- Filtrage

export const PERIODES_TRANSACTIONS = [
  { cle: "30j", libelle: "30 jours", jours: 30 },
  { cle: "90j", libelle: "90 jours", jours: 90 },
  { cle: "12m", libelle: "12 mois", jours: 365 },
  { cle: "tout", libelle: "Tout", jours: null },
] as const;

export type ClePeriode = (typeof PERIODES_TRANSACTIONS)[number]["cle"];

export type FiltresTransactions = {
  sens: SensFlux | "tous";
  source: SourceTransaction | "toutes";
  periode: ClePeriode;
  sansJustificatif: boolean;
  avecAnomalie: boolean;
  recherche: string;
};

export const FILTRES_PAR_DEFAUT: FiltresTransactions = {
  sens: "tous",
  source: "toutes",
  periode: "12m",
  sansJustificatif: false,
  avecAnomalie: false,
  recherche: "",
};

/**
 * Filtre de période seul — la base sur laquelle le bandeau d'anomalies et les compteurs
 * se calculent, pour qu'ils restent stables quand on coche « avec anomalie ».
 */
export function filtrerParPeriode(
  transactions: TransactionUnifiee[],
  periode: ClePeriode,
): TransactionUnifiee[] {
  const config = PERIODES_TRANSACTIONS.find((p) => p.cle === periode);
  const jours = config?.jours ?? null;
  if (jours === null) return transactions;

  const limite = Date.now() - jours * 24 * 60 * 60 * 1000;
  return transactions.filter((t) => {
    if (!t.date) return true; // une date manquante ne doit pas faire disparaître la ligne
    const ts = new Date(t.date).getTime();
    return Number.isNaN(ts) ? true : ts >= limite;
  });
}

function correspondRecherche(t: TransactionUnifiee, recherche: string): boolean {
  const q = recherche.trim().toLowerCase();
  if (!q) return true;
  return [t.contrepartie, t.reference, t.libelle]
    .filter((champ): champ is string => typeof champ === "string")
    .some((champ) => champ.toLowerCase().includes(q));
}

export function appliquerFiltres(
  transactions: TransactionUnifiee[],
  filtres: FiltresTransactions,
): TransactionUnifiee[] {
  return filtrerParPeriode(transactions, filtres.periode).filter((t) => {
    if (filtres.sens !== "tous" && t.sens !== filtres.sens) return false;
    if (filtres.source !== "toutes" && t.source !== filtres.source) return false;
    if (filtres.sansJustificatif && t.has_file) return false;
    if (filtres.avecAnomalie && t.incoherences.length === 0) return false;
    return correspondRecherche(t, filtres.recherche);
  });
}

// ---------------------------------------------------------------------------- Agrégats

export type TotauxFlux = {
  entrees: number;
  sorties: number;
  solde: number;
  nbFlux: number;
  /** Lignes retenues mais sans montant lisible : le solde est donc partiel. */
  nbSansMontant: number;
};

/** Totaux des seules lignes qui déplacent de l'argent (les contrats sont exclus). */
export function calculerTotaux(transactions: TransactionUnifiee[]): TotauxFlux {
  let entrees = 0;
  let sorties = 0;
  let nbFlux = 0;
  let nbSansMontant = 0;

  for (const t of transactions) {
    if (!t.est_flux) continue;
    nbFlux += 1;
    const montant = t.montant_net ?? t.montant_ht;
    if (montant === null) {
      nbSansMontant += 1;
      continue;
    }
    const valeur = Math.abs(montant);
    if (t.sens === "entrant") entrees += valeur;
    else sorties += valeur;
  }

  return { entrees, sorties, solde: entrees - sorties, nbFlux, nbSansMontant };
}

export type AnomalieAgregee = {
  message: string;
  occurrences: number;
};

/**
 * Anomalies relevées par l'agent, regroupées par message. Elles étaient jusqu'ici
 * calculées puis perdues : c'est la principale valeur ajoutée de l'écran.
 */
export function agregerAnomalies(transactions: TransactionUnifiee[]): AnomalieAgregee[] {
  const compte = new Map<string, number>();
  for (const t of transactions) {
    for (const message of t.incoherences) {
      compte.set(message, (compte.get(message) ?? 0) + 1);
    }
  }
  return [...compte.entries()]
    .map(([message, occurrences]) => ({ message, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

export function compterSansJustificatif(transactions: TransactionUnifiee[]): number {
  return transactions.filter((t) => !t.has_file).length;
}

export function compterAvecAnomalie(transactions: TransactionUnifiee[]): number {
  return transactions.filter((t) => t.incoherences.length > 0).length;
}
