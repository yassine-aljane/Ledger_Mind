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
import { formatEuros, formatPct, type PointMensuel } from "@/lib/finance";

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

/** Abattement appliqué à une catégorie — l'étape 1 du calcul, rendue lisible. */
export type LigneAbattement = {
  categorie: CategorieFiscale;
  ca: number;
  taux_abattement: number;
  abattement: number;
  base_imposable: number;
  plancher_applique: boolean;
};

/** Étapes de l'IR au barème pour un revenu net imposable donné. */
export type DetailIR = {
  revenu_net_imposable: number;
  parts: number;
  impot_avant_plafonnement: number;
  impot_apres_plafonnement: number;
  plafonnement_applique: boolean;
  decote: number;
  impot_net: number;
};

export type ResultatVersementLiberatoire = {
  eligible?: boolean | null;
  motif_ineligibilite?: string | null;
  plafond_rfr?: number | null;
  montant?: number | null;
};

export type OptionFiscale = "versement_liberatoire" | "bareme";

export type ResultatSimulation = {
  ca_total: number;
  lignes?: LigneAbattement[] | null;
  base_imposable: number;
  ir_bareme?: number | null;
  ir_bareme_calculable: boolean;
  // L'IR imputable au micro s'obtient par différence : impôt du foyer AVEC l'activité,
  // moins impôt du même foyer SANS elle. Ces deux détails rendent la méthode vérifiable.
  detail_avec_micro?: DetailIR | null;
  detail_sans_micro?: DetailIR | null;
  versement_liberatoire?: ResultatVersementLiberatoire | null;
  cotisations_sociales: number;
  cfp: number;
  acre_appliquee: boolean;
  ir_retenu?: number | null;
  option_retenue?: OptionFiscale | string | null;
  /** L'option la MOINS COÛTEUSE parmi celles ouvertes — un conseil, pas un choix imposé. */
  recommandation?: OptionFiscale | string | null;
  total_prelevements?: number | null;
  revenu_net_estime?: number | null;
  taux_effectif?: number | null;
  depassements?: DepassementPlafond[] | null;
  avertissements?: string[] | null;
  /** D'où vient chaque taux, et s'il a été recoupé avec la source officielle. */
  provenance?: Record<string, unknown> | null;
};

/**
 * Franchise en base de TVA.
 *
 * À ne pas confondre avec le plafond du régime : le seuil de franchise se franchit bien
 * plus tôt (37 500 € en prestations contre 77 700 € pour le régime). On peut donc devoir
 * facturer la TVA tout en restant micro-entrepreneur.
 */
export type AlerteTva = {
  niveau: "proche" | "depasse_base" | "depasse_majore" | string;
  message: string;
  seuil_base?: number | null;
  seuil_majore?: number | null;
  note?: string | null;
  source?: string | null;
};

export type ScenarioCalcule = {
  id: string;
  libelle: string;
  demande: DemandeSimulation;
  resultat: ResultatSimulation;
  /** `null` quand le seuil est encore loin. */
  alerte_tva?: AlerteTva | null;
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

export type Provenance = "explicite" | "suppose";

export type ChampCompris = "montant" | "categorie" | "recurrence" | "duree";

/**
 * Un paramètre extrait de la phrase, avec l'origine de sa valeur.
 *
 * `provenance` est ce qui rend une saisie en langage naturel honnête : l'utilisateur doit
 * pouvoir distinguer ce qu'il a DIT de ce que la machine a DEVINÉ à sa place.
 */
export type ElementCompris = {
  champ: ChampCompris;
  libelle: string;
  provenance: Provenance;
};

export type ScenarioInterprete = {
  id: string;
  libelle: string;
  /** Montant d'UNE échéance. Le CA annuel tient compte de la récurrence. */
  montant: number;
  categorie?: CategorieFiscale | null;
  recurrent?: boolean;
  mois?: number | null;
  ca_annuel: number;
  elements?: ElementCompris[] | null;
  propose?: boolean;
};

export type InterpretationScenario = {
  comprise: boolean;
  resume?: string | null;
  motif?: string | null;
  scenarios?: ScenarioInterprete[] | null;
  contre_scenarios?: ScenarioInterprete[] | null;
};

/**
 * Un scénario compris devient une variante calculable.
 *
 * `categorie` peut manquer quand le modèle n'a pas tranché : on retombe alors sur la
 * catégorie du contexte de l'utilisateur, et l'élément correspondant reste marqué
 * « supposé » à l'écran — jamais un choix silencieux.
 */
export function versVariante(
  scenario: ScenarioInterprete,
  categorieParDefaut: CategorieFiscale,
): VarianteScenario {
  return {
    id: scenario.id,
    libelle: scenario.libelle,
    ajouts: [
      {
        categorie: scenario.categorie ?? categorieParDefaut,
        ca: nombre(scenario.ca_annuel) ?? nombre(scenario.montant) ?? 0,
      },
    ],
  };
}

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
  /** Part du plafond consommée en fin d'année, en %. `null` si le plafond est inconnu. */
  pctPlafond: number | null;
};

export type Projection = {
  series: SerieProjection[];
  /** Plafond de la catégorie principale, tel que rendu par le moteur. `null` si inconnu. */
  plafond: number | null;
  plafondLibelle: string | null;
  /**
   * Borne haute de l'axe. Suit les DONNÉES, pas le plafond.
   *
   * Le forcer à englober le plafond écrasait les courbes : sur un CA de 30 000 € face à un
   * plafond BNC de 77 700 €, elles occupaient le tiers inférieur du graphe et l'on ne
   * distinguait plus deux scénarios voisins. Quand le plafond est hors de portée, il sort
   * du tracé et se lit sur une jauge — l'information est conservée, la courbe redevient
   * lisible.
   */
  maximum: number;
  /** Vrai quand le plafond tient dans le tracé sans l'aplatir. */
  plafondVisible: boolean;
  /** Dernier mois réellement observé (index 0-11). */
  dernierMoisReel: number;
};

/**
 * Au-delà de ce rapport entre plafond et données, tracer la ligne de plafond tasserait les
 * courbes au point de les rendre incomparables. 1,6 laisse le plafond visible dès qu'on
 * s'en approche vraiment — c'est-à-dire quand il devient l'information principale.
 */
const RATIO_PLAFOND_LISIBLE = 1.6;

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

    const fin = points[11]?.cumul ?? 0;
    return {
      id: scenario.id,
      libelle: scenario.libelle,
      points,
      moisFranchissement,
      pctPlafond: plafond !== null && plafond > 0 ? (fin / plafond) * 100 : null,
    };
  });

  const maximumDonnees = series.reduce(
    (max, serie) => Math.max(max, ...serie.points.map((p) => p.cumul)),
    0,
  );

  // Le plafond n'entre dans l'échelle que s'il ne coûte pas la lisibilité des courbes.
  const plafondVisible =
    plafond !== null && plafond > 0 && plafond <= Math.max(maximumDonnees, 1) * RATIO_PLAFOND_LISIBLE;

  return {
    series,
    plafond,
    plafondLibelle: plafondRetenu ? CATEGORIE_LIBELLE[plafondRetenu.categorie] : null,
    // 15 % d'air au-dessus du plus haut point : la courbe ne colle pas au bord.
    maximum: plafondVisible ? Math.max(maximumDonnees * 1.05, plafond) : maximumDonnees * 1.15,
    plafondVisible,
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

// ------------------------------------------------- Analyse : le parcours d'un euro

export type EtapeFlux = {
  cle: "abattement" | "cotisations" | "ir" | "cfp" | "net";
  label: string;
  montant: number;
  /** Part du CA total, entre 0 et 1 — la largeur du segment dans le flux. */
  part: number;
  explication: string;
};

export type FluxEuro = {
  caTotal: number;
  etapes: EtapeFlux[];
  /** Faux quand l'IR n'est pas calculable : le flux s'arrête avant le net. */
  complet: boolean;
};

export type MarcheCascade = {
  cle: EtapeFlux["cle"] | "ca";
  label: string;
  montant: number;
  part: number;
  /** Bornes de la marche sur l'échelle 0 → CA, en euros. */
  debut: number;
  fin: number;
  /** `depart` et `arrivee` sont des totaux ; `retrait` est ce qu'on soustrait. */
  type: "depart" | "retrait" | "arrivee";
  explication: string;
};

/**
 * La même donnée que `construireFluxEuro`, mise en marches d'escalier.
 *
 * Pourquoi cette forme plutôt qu'une barre empilée : sur un CA de 30 000 €, la formation
 * professionnelle pèse 0,20 %. Dans une barre de 700 px elle occupe 1,4 px — moins que
 * l'écart de 2 px qui la sépare de sa voisine, donc RIEN. L'impôt lui-même tombait à 7 px,
 * trop peu pour porter une étiquette. Une cascade donne à chaque poste sa propre ligne, de
 * hauteur fixe : la longueur varie, la lisibilité non.
 */
export function construireCascade(
  scenario: ScenarioCalcule | null | undefined,
): MarcheCascade[] {
  const flux = construireFluxEuro(scenario);
  if (!flux) return [];

  const ca = flux.caTotal;
  const marches: MarcheCascade[] = [
    {
      cle: "ca",
      label: "Chiffre d'affaires encaissé",
      montant: ca,
      part: 1,
      debut: 0,
      fin: ca,
      type: "depart",
      explication: "Le point de départ : ce que vos clients vous ont versé sur l'année.",
    },
  ];

  // Les retraits s'enchaînent dans l'ordre où ils frappent la trésorerie.
  let reste = ca;
  for (const cle of ["cotisations", "ir", "cfp"] as const) {
    const etape = flux.etapes.find((e) => e.cle === cle);
    if (!etape) continue;
    const debut = reste - etape.montant;
    marches.push({
      cle,
      label: etape.label,
      montant: etape.montant,
      part: etape.part,
      debut,
      fin: reste,
      type: "retrait",
      explication: etape.explication,
    });
    reste = debut;
  }

  const net = flux.etapes.find((e) => e.cle === "net");
  if (net) {
    marches.push({
      cle: "net",
      label: net.label,
      montant: net.montant,
      part: net.part,
      debut: 0,
      fin: net.montant,
      type: "arrivee",
      explication: net.explication,
    });
  }

  return marches;
}

/**
 * Ce que devient un euro facturé, de gauche à droite : abattement, cotisations, impôt,
 * formation, puis ce qui reste.
 *
 * L'abattement figure en tête parce qu'il explique pourquoi l'impôt porte sur bien moins
 * que le chiffre d'affaires — c'est le premier « mais pourquoi ? » de tout micro-entrepreneur.
 * Tous les montants viennent du moteur ; ce module ne fait que des parts d'un total.
 */
export function construireFluxEuro(scenario: ScenarioCalcule | null | undefined): FluxEuro | null {
  const r = scenario?.resultat;
  if (!r) return null;

  const ca = nombre(r.ca_total) ?? 0;
  if (ca <= 0) return null;

  const abattement = liste(r.lignes).reduce((somme, l) => somme + (nombre(l?.abattement) ?? 0), 0);
  const cotisations = nombre(r.cotisations_sociales) ?? 0;
  const cfp = nombre(r.cfp) ?? 0;
  const ir = nombre(r.ir_retenu);
  const net = nombre(r.revenu_net_estime);

  const tauxMoyen = liste(r.lignes)[0]?.taux_abattement;
  const etapes: EtapeFlux[] = [
    {
      cle: "abattement",
      label: "Abattement forfaitaire",
      montant: abattement,
      part: abattement / ca,
      explication:
        tauxMoyen != null
          ? `L'administration retire ${formatPct(tauxMoyen * 100)} de votre chiffre d'affaires avant de calculer l'impôt. Cet abattement remplace la déduction de vos frais réels.`
          : "L'administration retire une part forfaitaire de votre chiffre d'affaires avant de calculer l'impôt.",
    },
    {
      cle: "cotisations",
      label: "Cotisations sociales",
      montant: cotisations,
      part: cotisations / ca,
      explication:
        "Prélevées sur le chiffre d'affaires encaissé, indépendamment de votre foyer fiscal.",
    },
    {
      cle: "ir",
      label: "Impôt sur le revenu",
      montant: ir ?? 0,
      part: (ir ?? 0) / ca,
      explication:
        "Calculé sur la base après abattement, selon l'option retenue et la situation de votre foyer.",
    },
    {
      cle: "cfp",
      label: "Formation professionnelle",
      montant: cfp,
      part: cfp / ca,
      explication: "Contribution obligatoire, proportionnelle au chiffre d'affaires.",
    },
    {
      cle: "net",
      label: "Ce qui vous reste",
      montant: net ?? 0,
      part: (net ?? 0) / ca,
      explication: "Chiffre d'affaires encaissé, moins l'ensemble des prélèvements.",
    },
  ];

  return { caTotal: ca, etapes, complet: ir !== null && net !== null };
}

// --------------------------------------- Analyse : versement libératoire ou barème

export type ComparaisonOption = {
  optionRetenue: OptionFiscale | null;
  recommandation: OptionFiscale | null;
  montantBareme: number | null;
  montantVersementLiberatoire: number | null;
  eligible: boolean | null;
  motifIneligibilite: string | null;
  plafondRfr: number | null;
  /** Économie annuelle de l'option recommandée face à l'autre. `null` si incomparable. */
  economie: number | null;
};

function optionValide(valeur: unknown): OptionFiscale | null {
  return valeur === "versement_liberatoire" || valeur === "bareme" ? valeur : null;
}

/**
 * Les deux façons de payer l'impôt, côte à côte.
 *
 * Le moteur calcule déjà laquelle coûte le moins cher (`recommandation`) et ne l'a jamais
 * montrée. C'est pourtant le seul conseil actionnable de tout l'écran : une case à cocher
 * au moment de la déclaration, qui peut valoir plusieurs centaines d'euros.
 */
export function construireComparaisonOption(
  scenario: ScenarioCalcule | null | undefined,
): ComparaisonOption | null {
  const r = scenario?.resultat;
  if (!r) return null;

  const vl = r.versement_liberatoire ?? {};
  const montantVl = nombre(vl.montant);
  const montantBareme = nombre(r.ir_bareme);
  const recommandation = optionValide(r.recommandation);

  const economie =
    montantVl !== null && montantBareme !== null
      ? Math.round(Math.abs(montantVl - montantBareme) * 100) / 100
      : null;

  return {
    optionRetenue: optionValide(r.option_retenue),
    recommandation,
    montantBareme,
    montantVersementLiberatoire: montantVl,
    eligible: typeof vl.eligible === "boolean" ? vl.eligible : null,
    motifIneligibilite: typeof vl.motif_ineligibilite === "string" ? vl.motif_ineligibilite : null,
    plafondRfr: nombre(vl.plafond_rfr),
    economie,
  };
}

// ------------------------------------------------------ Analyse : le détail du calcul

export type EtapeCalcul = {
  cle: string;
  titre: string;
  valeur: string | null;
  detail: string;
  /** Vrai quand l'étape n'a pas pu être calculée : l'écran le dit au lieu d'afficher 0. */
  nonCalculable?: boolean;
};

/**
 * Le calcul étape par étape, dans l'ordre où le moteur le mène.
 *
 * Ce bloc n'existe que pour répondre à « d'où sort ce chiffre ? ». Il ne recalcule rien :
 * il met en phrases des valeurs déjà produites, et dit explicitement lesquelles manquent.
 */
export function etapesCalcul(scenario: ScenarioCalcule | null | undefined): EtapeCalcul[] {
  const r = scenario?.resultat;
  if (!r) return [];

  const etapes: EtapeCalcul[] = [];

  for (const ligne of liste(r.lignes)) {
    if (!ligne) continue;
    const taux = nombre(ligne.taux_abattement);
    etapes.push({
      cle: `abattement-${ligne.categorie}`,
      titre: `Abattement — ${CATEGORIE_LIBELLE[ligne.categorie] ?? ligne.categorie}`,
      valeur: formatEuros(nombre(ligne.base_imposable)),
      detail:
        `Sur ${formatEuros(nombre(ligne.ca))} de chiffre d'affaires, ` +
        `${formatEuros(nombre(ligne.abattement))} d'abattement` +
        (taux !== null ? ` (${formatPct(taux * 100)})` : "") +
        `, soit ${formatEuros(nombre(ligne.base_imposable))} de base imposable.` +
        (ligne.plancher_applique
          ? " Le plancher d'abattement s'est appliqué : il était plus favorable que le calcul proportionnel."
          : ""),
    });
  }

  const avec = r.detail_avec_micro;
  const sans = r.detail_sans_micro;
  if (avec && sans) {
    etapes.push({
      cle: "ir-differentiel",
      titre: "Impôt imputable à l'activité",
      valeur: formatEuros(nombre(r.ir_bareme)),
      detail:
        `Impôt du foyer avec cette activité : ${formatEuros(nombre(avec.impot_net))}. ` +
        `Sans elle : ${formatEuros(nombre(sans.impot_net))}. ` +
        `La différence est ce que l'activité coûte réellement.` +
        (avec.plafonnement_applique
          ? " Le plafonnement du quotient familial a joué sur ce calcul."
          : "") +
        (nombre(avec.decote) ? ` Une décote de ${formatEuros(nombre(avec.decote))} a été appliquée.` : ""),
    });
  } else if (!r.ir_bareme_calculable) {
    etapes.push({
      cle: "ir-non-calculable",
      titre: "Impôt sur le revenu",
      valeur: null,
      detail:
        "Non calculé : le nombre de parts fiscales et les autres revenus du foyer sont " +
        "nécessaires, et personne d'autre que vous ne les connaît.",
      nonCalculable: true,
    });
  }

  etapes.push({
    cle: "cotisations",
    titre: "Cotisations sociales",
    valeur: formatEuros(nombre(r.cotisations_sociales)),
    detail: r.acre_appliquee
      ? "Taux minoré par l'ACRE sur cette période."
      : "Assises sur le chiffre d'affaires encaissé, sans lien avec le foyer fiscal.",
  });

  etapes.push({
    cle: "cfp",
    titre: "Formation professionnelle",
    valeur: formatEuros(nombre(r.cfp)),
    detail: "Contribution obligatoire, proportionnelle au chiffre d'affaires.",
  });

  const total = nombre(r.total_prelevements);
  etapes.push({
    cle: "total",
    titre: "Total des prélèvements",
    valeur: total === null ? null : formatEuros(total),
    detail:
      total === null
        ? "Le total reste inconnu tant que l'impôt sur le revenu n'est pas calculable."
        : `Soit ${formatPct((nombre(r.taux_effectif) ?? 0) * 100)} du chiffre d'affaires.`,
    nonCalculable: total === null,
  });

  return etapes;
}

export type SourceChiffres = {
  cle: string;
  libelle: string;
  annee: number | null;
  dateVerification: string | null;
  /** `null` quand la source ne porte pas l'information — on ne suppose pas « vérifié ». */
  verifie: boolean | null;
};

const LIBELLE_SOURCE: Record<string, string> = {
  seuils: "Plafonds, abattements et cotisations",
  impot_revenu: "Barème de l'impôt sur le revenu",
};

/** Provenance des taux, telle que le moteur la déclare. Rien n'est reformulé ni embelli. */
export function lireProvenance(
  scenario: ScenarioCalcule | null | undefined,
): SourceChiffres[] {
  const brut = scenario?.resultat?.provenance;
  if (!brut || typeof brut !== "object") return [];

  return Object.entries(brut).flatMap(([cle, valeur]) => {
    if (!valeur || typeof valeur !== "object") return [];
    const bloc = valeur as Record<string, unknown>;
    return [
      {
        cle,
        libelle: LIBELLE_SOURCE[cle] ?? cle,
        annee: typeof bloc.annee === "number" ? bloc.annee : null,
        dateVerification: typeof bloc.date_verif === "string" ? bloc.date_verif : null,
        verifie: typeof bloc.verifie === "boolean" ? bloc.verifie : null,
      },
    ];
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
