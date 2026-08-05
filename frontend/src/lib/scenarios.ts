/**
 * Scénarios « et si… » — accès à l'API et préparation des séries.
 *
 * DEUX RÈGLES, tenues sans exception dans ce fichier :
 *
 * 1. **Aucune formule fiscale ici.** Pas un taux, pas un abattement, pas un barème, pas un
 *    plafond. Tout montant fiscal vient de `POST /api/simulation/scenarios`, qui délègue à
 *    `app.agents.impots.moteur`. Le plafond lui-même transite par l'API (`plafonds`) plutôt
 *    que d'être recopié ici : une constante dupliquée finit toujours par diverger.
 *    Ce module ne fait que des additions de présentation — répartir un CA sur des mois pour
 *    le tracer — et jamais un calcul d'impôt.
 *
 * 2. **Ce qui n'est pas calculé reste `null`.** Le moteur renvoie `None` quand il manque le
 *    foyer fiscal ; ces `null` traversent le module sans jamais devenir zéro. Un zéro se
 *    lirait « vous ne paierez rien », ce qui est faux et coûteux.
 */

import { authHeaders, clearAuth } from "@/lib/auth";
import type { PointMensuel } from "@/lib/finance";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

// ------------------------------------------------------------------ Miroir de l'API

export type CategorieFiscale = "BIC_VENTE" | "BIC_SERVICE" | "BNC";
export type CaisseBNC = "REGIME_GENERAL" | "CIPAV";

export const CATEGORIE_LIBELLE: Record<CategorieFiscale, string> = {
  BIC_VENTE: "Vente de marchandises",
  BIC_SERVICE: "Prestation commerciale",
  BNC: "Prestation libérale",
};

export type ActiviteCA = { categorie: CategorieFiscale; ca: number };

export type ContexteFoyer = {
  parts?: number | null;
  autres_revenus?: number | null;
  en_couple?: boolean;
  rfr_n2?: number | null;
};

export type DemandeSimulation = {
  activites: ActiviteCA[];
  foyer: ContexteFoyer;
  caisse_bnc?: CaisseBNC;
  acre_active?: boolean;
  option_versement_liberatoire?: boolean;
  jours_activite?: number | null;
};

export type DepassementPlafond = {
  categorie: CategorieFiscale;
  ca: number;
  plafond: number;
  plafond_proratise: boolean;
};

export type ResultatSimulation = {
  ca_total: number;
  base_imposable: number;
  ir_bareme?: number | null;
  ir_bareme_calculable: boolean;
  cotisations_sociales: number;
  cfp: number;
  acre_appliquee: boolean;
  ir_retenu?: number | null;
  option_retenue?: string | null;
  recommandation?: string | null;
  total_prelevements?: number | null;
  revenu_net_estime?: number | null;
  taux_effectif?: number | null;
  depassements?: DepassementPlafond[] | null;
  avertissements?: string[] | null;
};

export type ScenarioCalcule = {
  id: string;
  libelle: string;
  demande: DemandeSimulation;
  resultat: ResultatSimulation;
};

export type ChampManquant = { champ: string; libelle: string; consequence: string };

export type PlafondCategorie = {
  categorie: CategorieFiscale;
  plafond: number;
  proratise: boolean;
};

export type ReponseScenarios = {
  scenarios: ScenarioCalcule[];
  champs_manquants: ChampManquant[];
  plafonds: PlafondCategorie[];
};

export type ContexteSimulation = {
  base: DemandeSimulation;
  champs_manquants: ChampManquant[];
  ca_source: string;
  annee: number;
  nb_factures_prises_en_compte: number;
};

export type VarianteScenario = {
  id: string;
  libelle: string;
  ajouts?: ActiviteCA[];
  option_versement_liberatoire?: boolean | null;
  acre_active?: boolean | null;
  caisse_bnc?: CaisseBNC | null;
};

export type InterpretationScenario = {
  comprise: boolean;
  montant?: number | null;
  categorie?: CategorieFiscale | null;
  recurrent?: boolean;
  mois?: number | null;
  libelle?: string | null;
  resume?: string | null;
  motif?: string | null;
};

// ------------------------------------------------------------------------- Appels

async function parseError(response: Response): Promise<string> {
  if (response.status === 401) clearAuth();
  const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return typeof err?.detail === "string" ? err.detail : `HTTP ${response.status}`;
}

async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${chemin}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<T>;
}

export function chargerContexte(): Promise<ContexteSimulation> {
  return requete<ContexteSimulation>("/api/simulation/contexte");
}

export function simulerScenarios(
  base: DemandeSimulation,
  variantes: VarianteScenario[],
): Promise<ReponseScenarios> {
  return requete<ReponseScenarios>("/api/simulation/scenarios", {
    method: "POST",
    body: JSON.stringify({ base, variantes }),
  });
}

export function interpreterPhrase(phrase: string): Promise<InterpretationScenario> {
  return requete<InterpretationScenario>("/api/simulation/interpreter", {
    method: "POST",
    body: JSON.stringify({ phrase }),
  });
}

// ---------------------------------------------------------------------- Garde-fous

function nombre(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function liste<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** CA total d'un scénario, ou 0 : c'est une somme d'activités saisies, jamais un calcul. */
export function caTotal(scenario: ScenarioCalcule): number {
  return nombre(scenario.resultat?.ca_total) ?? 0;
}

// ------------------------------------------------------- Série 1 : projection annuelle

export const MOIS_COURTS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

export type PointProjection = {
  /** Index du mois dans l'année civile, 0 = janvier. */
  mois: number;
  label: string;
  /** Cumul de CA à la fin de ce mois. */
  cumul: number;
  /** Vrai tant que le mois est passé : au-delà, c'est une projection, pas un relevé. */
  reel: boolean;
};

export type SerieProjection = {
  id: string;
  libelle: string;
  points: PointProjection[];
  /** Mois où la courbe franchit le plafond, `null` si elle ne le franchit pas. */
  moisFranchissement: number | null;
};

export type Projection = {
  series: SerieProjection[];
  /** Plafond de la catégorie principale, tel que rendu par le moteur. `null` si inconnu. */
  plafond: number | null;
  plafondLibelle: string | null;
  maximum: number;
  /** Dernier mois réellement observé (index 0-11). */
  dernierMoisReel: number;
};

/**
 * Cumul mensuel réel de l'année en cours, extrait de la série déjà construite par
 * `construireSynthese`. On ne recalcule pas le CA : on le relit.
 */
function cumulReel(points: PointMensuel[], annee: number): number[] {
  const parMois = new Array<number>(12).fill(0);
  for (const point of liste(points)) {
    const cle = typeof point?.cle === "string" ? point.cle : "";
    const [a, m] = cle.split("-");
    if (Number(a) !== annee) continue;
    const index = Number(m) - 1;
    if (Number.isInteger(index) && index >= 0 && index < 12) {
      parMois[index] += nombre(point.total_ht) ?? 0;
    }
  }

  const cumul: number[] = [];
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    total += parMois[i];
    cumul.push(Math.round(total * 100) / 100);
  }
  return cumul;
}

/**
 * Projection de CA sur l'année civile, une courbe par scénario.
 *
 * Hypothèse de tracé, à afficher telle quelle à l'utilisateur : les mois écoulés portent le
 * CA réellement facturé ; les mois restants prolongent la moyenne mensuelle observée, et le
 * surcroît de CA d'une variante s'y répartit également. C'est une mise en forme, pas une
 * prévision : rien ici ne prétend savoir quand un contrat sera encaissé.
 */
export function construireProjection(
  pointsReels: PointMensuel[],
  scenarios: ScenarioCalcule[],
  plafonds: PlafondCategorie[],
  aujourdhui: Date = new Date(),
): Projection {
  const annee = aujourdhui.getFullYear();
  const dernierMoisReel = aujourdhui.getMonth();
  const cumul = cumulReel(pointsReels, annee);

  const acquis = cumul[dernierMoisReel] ?? 0;
  const moisEcoules = dernierMoisReel + 1;
  const moisRestants = 12 - moisEcoules;
  const rythmeMensuel = moisEcoules > 0 ? acquis / moisEcoules : 0;

  const base = scenarios[0];
  const caBase = base ? caTotal(base) : 0;

  // Le plafond retenu est celui de la catégorie qui porte le plus de CA : c'est la seule
  // ligne de repère qui ait un sens sur une courbe de cumul toutes catégories confondues.
  const principale = [...liste(base?.demande?.activites)].sort(
    (a, b) => (nombre(b?.ca) ?? 0) - (nombre(a?.ca) ?? 0),
  )[0];
  const plafondRetenu =
    liste(plafonds).find((p) => p.categorie === principale?.categorie) ?? liste(plafonds)[0] ?? null;
  const plafond = plafondRetenu ? nombre(plafondRetenu.plafond) : null;

  const series: SerieProjection[] = liste(scenarios).map((scenario) => {
    // Ce que la variante ajoute par rapport à la base, réparti sur les mois qui restent.
    const supplement = Math.max(0, caTotal(scenario) - caBase);
    const parMoisRestant = moisRestants > 0 ? supplement / moisRestants : 0;

    const points: PointProjection[] = [];
    let moisFranchissement: number | null = null;

    for (let mois = 0; mois < 12; mois += 1) {
      const reel = mois <= dernierMoisReel;
      const valeur = reel
        ? (cumul[mois] ?? 0)
        : acquis + (rythmeMensuel + parMoisRestant) * (mois - dernierMoisReel);
      const arrondi = Math.round(valeur * 100) / 100;

      if (moisFranchissement === null && plafond !== null && arrondi > plafond) {
        moisFranchissement = mois;
      }
      points.push({ mois, label: MOIS_COURTS[mois] ?? "", cumul: arrondi, reel });
    }

    return { id: scenario.id, libelle: scenario.libelle, points, moisFranchissement };
  });

  const maximum = series.reduce(
    (max, serie) => Math.max(max, ...serie.points.map((p) => p.cumul)),
    plafond ?? 0,
  );

  return {
    series,
    plafond,
    plafondLibelle: plafondRetenu ? CATEGORIE_LIBELLE[plafondRetenu.categorie] : null,
    maximum,
    dernierMoisReel,
  };
}

// ---------------------------------------------------- Série 2 : décomposition du net

export type PartDecomposition = {
  cle: "cotisations" | "ir" | "cfp" | "net";
  label: string;
  montant: number;
};

export type DecompositionScenario = {
  id: string;
  libelle: string;
  caTotal: number;
  parts: PartDecomposition[];
  /** Faux quand l'IR n'a pas pu être calculé : la décomposition est alors incomplète. */
  complete: boolean;
};

/**
 * Ce que devient le chiffre d'affaires, scénario par scénario.
 *
 * Les quatre montants viennent tels quels du moteur. Quand l'IR n'est pas calculable, la
 * décomposition est marquée incomplète et la part « net » n'est PAS déduite : afficher un
 * net qui ignore l'impôt serait plus trompeur que de ne rien afficher.
 */
export function construireDecomposition(scenarios: ScenarioCalcule[]): DecompositionScenario[] {
  return liste(scenarios).map((scenario) => {
    const r = scenario.resultat ?? ({} as ResultatSimulation);
    const ca = nombre(r.ca_total) ?? 0;
    const cotisations = nombre(r.cotisations_sociales) ?? 0;
    const cfp = nombre(r.cfp) ?? 0;
    const ir = nombre(r.ir_retenu);
    const net = nombre(r.revenu_net_estime);

    const parts: PartDecomposition[] = [
      { cle: "cotisations", label: "Cotisations sociales", montant: cotisations },
      { cle: "ir", label: "Impôt sur le revenu", montant: ir ?? 0 },
      { cle: "cfp", label: "Formation professionnelle", montant: cfp },
      { cle: "net", label: "Net estimé", montant: net ?? 0 },
    ];

    return {
      id: scenario.id,
      libelle: scenario.libelle,
      caTotal: ca,
      parts,
      complete: ir !== null && net !== null,
    };
  });
}

// -------------------------------------------------------- Série 3 : provision mensuelle

export type Provision = {
  id: string;
  libelle: string;
  /** Ce qu'il faut mettre de côté chaque mois. `null` si les prélèvements sont inconnus. */
  parMois: number | null;
  totalAnnuel: number | null;
  tauxEffectif: number | null;
};

/**
 * « Combien je mets de côté chaque mois ? » — la seule question que l'utilisateur se pose
 * vraiment. Division par douze d'un total produit par le moteur : aucune fiscalité ajoutée.
 */
export function construireProvisions(scenarios: ScenarioCalcule[]): Provision[] {
  return liste(scenarios).map((scenario) => {
    const total = nombre(scenario.resultat?.total_prelevements);
    return {
      id: scenario.id,
      libelle: scenario.libelle,
      parMois: total === null ? null : Math.round((total / 12) * 100) / 100,
      totalAnnuel: total,
      tauxEffectif: nombre(scenario.resultat?.taux_effectif),
    };
  });
}

// ------------------------------------------------------------------------- Écarts

export type EcartScenario = {
  id: string;
  libelle: string;
  /** Différence de CA face à la base. */
  deltaCa: number;
  /** Différence de net perçu. `null` si l'un des deux nets n'est pas calculable. */
  deltaNet: number | null;
  deltaPrelevements: number | null;
};

export function construireEcarts(scenarios: ScenarioCalcule[]): EcartScenario[] {
  const base = liste(scenarios)[0];
  if (!base) return [];
  const netBase = nombre(base.resultat?.revenu_net_estime);
  const prelevBase = nombre(base.resultat?.total_prelevements);
  const caBase = caTotal(base);

  return scenarios.slice(1).map((scenario) => {
    const net = nombre(scenario.resultat?.revenu_net_estime);
    const prelev = nombre(scenario.resultat?.total_prelevements);
    return {
      id: scenario.id,
      libelle: scenario.libelle,
      deltaCa: Math.round((caTotal(scenario) - caBase) * 100) / 100,
      deltaNet: net === null || netBase === null ? null : Math.round((net - netBase) * 100) / 100,
      deltaPrelevements:
        prelev === null || prelevBase === null ? null : Math.round((prelev - prelevBase) * 100) / 100,
    };
  });
}

/** Tous les dépassements de plafond constatés, scénario par scénario. */
export function depassementsParScenario(
  scenarios: ScenarioCalcule[],
): { id: string; libelle: string; depassements: DepassementPlafond[] }[] {
  return liste(scenarios)
    .map((s) => ({
      id: s.id,
      libelle: s.libelle,
      depassements: liste(s.resultat?.depassements),
    }))
    .filter((s) => s.depassements.length > 0);
}

/** Avertissements du moteur, dédoublonnés — ils se répètent d'un scénario à l'autre. */
export function avertissementsUniques(scenarios: ScenarioCalcule[]): string[] {
  const vus = new Set<string>();
  for (const scenario of liste(scenarios)) {
    for (const message of liste(scenario.resultat?.avertissements)) {
      if (typeof message === "string" && message.trim()) vus.add(message.trim());
    }
  }
  return [...vus];
}
