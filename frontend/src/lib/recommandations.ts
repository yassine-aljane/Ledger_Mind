/**
 * Recommandations d'aide à la décision — « je signe, ou pas ? »
 *
 * --- CE QUE CE MODULE EST, ET N'EST PAS ---
 *
 * Ce n'est PAS un conseiller. Aucune phrase ici n'est produite par un modèle de langage, et
 * aucune règle fiscale n'y est écrite : les seuils, plafonds, taux et alertes viennent tous
 * du backend (`app.agents.impots` pour le calcul, `app.agents.facture.reglementaire` pour
 * la franchise de TVA). Ce module ne fait que RAPPROCHER des faits déjà établis :
 *
 *   « le moteur a calculé X » + « vos factures montrent Y » ⇒ « voici ce que ça implique ».
 *
 * Chaque recommandation porte donc trois choses, dans cet ordre : le CONSTAT (un fait
 * chiffré, avec sa source), la CONSÉQUENCE (ce que ce fait entraîne), et l'ACTION (ce qu'il
 * y a à faire, ou à vérifier). Sans les trois, ce n'est pas une recommandation, c'est une
 * opinion — et une opinion sur la fiscalité de quelqu'un d'autre n'a aucune valeur.
 *
 * `source` n'est pas décoratif : il dit à l'utilisateur d'où sort l'affirmation, et donc
 * quoi corriger si elle est fausse.
 *
 * --- LES SEUILS D'INTERPRÉTATION ---
 *
 * Deux seuils sont écrits ici parce qu'ils ne relèvent d'aucun texte : la concentration
 * client (50 %) et la couverture de trésorerie. Ce sont des HEURISTIQUES DE RISQUE, pas du
 * droit, et elles sont annoncées comme telles à l'écran. Tout ce qui relève du droit —
 * plafonds, seuils de TVA, taux — reste hors de ce fichier.
 */

import type { Facture } from "@/lib/facturation-api";
import { formatEuros, formatPct, type SyntheseFinanciere } from "@/lib/finance";
import type {
  ChampManquant,
  EcartScenario,
  Projection,
  Provision,
  ScenarioCalcule,
} from "@/lib/scenarios";

export type Gravite = "critique" | "attention" | "info" | "favorable";

export type SourceRecommandation =
  | "moteur fiscal"
  | "vos factures"
  | "votre profil"
  | "votre trésorerie";

export type Recommandation = {
  id: string;
  gravite: Gravite;
  titre: string;
  /** Le fait observé, chiffré. */
  constat: string;
  /** Ce que ce fait entraîne. */
  consequence: string;
  /** Ce qu'il y a à faire — ou à vérifier auprès de qui. */
  action: string;
  source: SourceRecommandation;
};

const ORDRE_GRAVITE: Record<Gravite, number> = {
  critique: 0,
  attention: 1,
  favorable: 2,
  info: 3,
};

function nombre(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function liste<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

// ------------------------------------------------------------------- Règles : le moteur

/**
 * Franchise de TVA. La conséquence la plus concrète d'un contrat signé, et la plus souvent
 * ignorée : le seuil de franchise se franchit BIEN AVANT le plafond du régime — 37 500 €
 * contre 77 700 € en prestations. On peut donc devoir facturer la TVA tout en restant
 * micro-entrepreneur, ce qui change le prix vu par le client.
 */
function regleTva(scenario: ScenarioCalcule): Recommandation | null {
  const alerte = scenario.alerte_tva;
  if (!alerte) return null;

  const gravite: Gravite =
    alerte.niveau === "depasse_majore"
      ? "critique"
      : alerte.niveau === "depasse_base"
        ? "attention"
        : "info";

  const consequence =
    alerte.niveau === "proche"
      ? "Encore sous le seuil, mais la marge est mince : un contrat de plus peut suffire à le franchir."
      : "Vous devrez facturer la TVA à vos clients et la reverser. Pour un client particulier, cela renchérit votre prix ; pour un client professionnel, il la récupère.";

  return {
    id: "tva",
    gravite,
    titre:
      alerte.niveau === "proche"
        ? "Vous approchez du seuil de franchise de TVA"
        : "Ce scénario vous fait sortir de la franchise de TVA",
    // Le message vient du backend réglementaire : on le reprend mot pour mot.
    constat: alerte.message,
    consequence,
    action:
      (alerte.note ?? "") +
      " Vérifiez votre chiffre d'affaires ENCAISSÉ, et prévenez vos clients avant de changer vos prix.",
    source: "moteur fiscal",
  };
}

/** Dépassement du plafond du régime — un fait constaté, jamais une sortie de régime décidée. */
function reglePlafond(
  scenario: ScenarioCalcule,
  projection: Projection,
): Recommandation | null {
  const depassements = liste(scenario.resultat?.depassements);
  if (depassements.length === 0) return null;

  const serie = projection.series.find((s) => s.id === scenario.id);
  const mois =
    serie?.moisFranchissement != null ? serie.points[serie.moisFranchissement]?.label : null;
  const premier = depassements[0];

  return {
    id: "plafond",
    gravite: "critique",
    titre: "Ce scénario dépasse le plafond de votre régime",
    constat: `${formatEuros(premier?.ca)} de chiffre d'affaires face à un plafond de ${formatEuros(premier?.plafond)}${mois ? `, franchi en ${mois}` : ""}.`,
    consequence:
      "Un dépassement sur une seule année ne vous fait PAS sortir du régime micro : la sortie suppose deux années consécutives au-dessus. Mais la deuxième année déclencherait un changement de régime, avec une comptabilité complète à tenir.",
    action:
      "Regardez si le contrat peut être étalé sur deux exercices, et faites confirmer le calendrier par un expert-comptable avant de signer.",
    source: "moteur fiscal",
  };
}

/** Option d'imposition : le moteur sait laquelle coûte le moins cher, et ne le disait pas. */
function regleOption(scenario: ScenarioCalcule): Recommandation | null {
  const r = scenario.resultat;
  const recommandation = r?.recommandation;
  const vl = nombre(r?.versement_liberatoire?.montant);
  const bareme = nombre(r?.ir_bareme);
  if (!recommandation || vl === null || bareme === null) return null;

  const economie = Math.abs(vl - bareme);
  if (economie < 1) return null;

  const gagnante =
    recommandation === "versement_liberatoire" ? "le versement libératoire" : "le barème progressif";
  const dejaBonne = r?.option_retenue === recommandation;

  return {
    id: "option",
    gravite: dejaBonne ? "favorable" : "attention",
    titre: dejaBonne
      ? "Votre option d'imposition est la bonne"
      : `Une autre option d'imposition vous ferait économiser ${formatEuros(economie)}`,
    constat: `Barème progressif : ${formatEuros(bareme)}. Versement libératoire : ${formatEuros(vl)}.`,
    consequence: dejaBonne
      ? `Sur ce scénario, ${gagnante} est le moins coûteux, et c'est celui que vous avez retenu.`
      : `Sur ce scénario, ${gagnante} coûte ${formatEuros(economie)} de moins que l'option actuellement retenue.`,
    action: dejaBonne
      ? "Rien à faire. Ce classement peut s'inverser si vos revenus changent : revenez-y avant votre prochaine déclaration."
      : "L'option se choisit auprès de l'URSSAF et n'est pas rétroactive. Vérifiez la date limite applicable à votre situation avant de basculer.",
    source: "moteur fiscal",
  };
}

/**
 * Ce que rapporte VRAIMENT le contrat.
 *
 * Le chiffre décisif, et celui que personne ne calcule de tête : sur les euros
 * supplémentaires, quelle part reste après prélèvements. Simple rapport de deux sorties du
 * moteur — aucune fiscalité ajoutée.
 */
function regleEffetMarginal(ecart: EcartScenario | undefined): Recommandation | null {
  if (!ecart) return null;
  const deltaNet = nombre(ecart.deltaNet);
  const deltaCa = nombre(ecart.deltaCa);
  if (deltaNet === null || deltaCa === null || deltaCa <= 0) return null;

  const part = deltaNet / deltaCa;

  return {
    id: "effet-marginal",
    gravite: part >= 0.6 ? "favorable" : "attention",
    titre: `Sur ce contrat, vous gardez ${formatPct(part * 100)}`,
    constat: `${formatEuros(deltaCa)} de chiffre d'affaires en plus, ${formatEuros(deltaNet)} de net en plus.`,
    consequence:
      part >= 0.6
        ? "Le rendement de ce contrat est comparable à celui de votre activité actuelle."
        : `Les prélèvements absorbent ${formatPct((1 - part) * 100)} de ce contrat — sensiblement plus que votre taux moyen actuel.`,
    action:
      part >= 0.6
        ? "Rien à signaler de ce côté."
        : "Si ce contrat vous fait changer de tranche ou franchir un seuil, une négociation de prix peut se justifier.",
    source: "moteur fiscal",
  };
}

/** ACRE : le moteur signale lui-même que son allègement est approché. */
function regleAcre(scenario: ScenarioCalcule): Recommandation | null {
  if (!scenario.resultat?.acre_appliquee) return null;
  return {
    id: "acre",
    gravite: "info",
    titre: "Vos cotisations tiennent compte de l'ACRE",
    constat: "L'exonération de début d'activité est appliquée sur cette période.",
    consequence:
      "L'allègement réel est légèrement inférieur à celui affiché : le calcul retient une approximation, et l'ACRE s'éteint en cours d'année.",
    action:
      "Prévoyez une hausse des cotisations à l'extinction de l'ACRE, et provisionnez un peu plus que le montant indiqué.",
    source: "moteur fiscal",
  };
}

// ------------------------------------------------- Règles : vos factures, votre trésorerie

/**
 * Provision à constituer face à l'argent qui n'est pas encore rentré.
 *
 * Le rapprochement le plus utile de tout l'écran : il ne sert à rien de savoir qu'il faut
 * mettre 679 € de côté chaque mois si 3 200 € de factures dorment chez des clients.
 */
function regleTresorerie(
  provision: Provision | undefined,
  synthese: SyntheseFinanciere,
): Recommandation | null {
  const parMois = nombre(provision?.parMois);
  const resteAEncaisser = nombre(synthese?.reste_a_encaisser);
  if (parMois === null || parMois <= 0 || resteAEncaisser === null || resteAEncaisser <= 0) {
    return null;
  }

  const moisCouverts = resteAEncaisser / parMois;
  const tendu = moisCouverts < 1;

  return {
    id: "tresorerie",
    gravite: tendu ? "attention" : "info",
    titre: "Ce que vous devez provisionner, face à ce qui reste à encaisser",
    constat: `${formatEuros(parMois)} à mettre de côté chaque mois, alors que ${formatEuros(resteAEncaisser)} de factures ne sont pas encore encaissées.`,
    consequence: tendu
      ? "Les encaissements en attente ne couvrent même pas un mois de provision : un retard de paiement se transformerait directement en difficulté à payer vos cotisations."
      : `Les encaissements en attente représentent environ ${moisCouverts.toFixed(1)} mois de provision.`,
    action: tendu
      ? "Relancez les factures échues avant de vous engager sur un nouveau contrat."
      : "Provisionnez dès l'encaissement, pas à l'échéance de l'URSSAF.",
    source: "votre trésorerie",
  };
}

/**
 * Concentration client.
 *
 * Le seuil de 50 % est une HEURISTIQUE de risque, pas une règle de droit — l'écran le dit.
 * Ce qui est factuel, c'est la part elle-même, calculée sur les factures de l'utilisateur.
 */
function regleConcentration(synthese: SyntheseFinanciere): Recommandation | null {
  const clients = liste(synthese?.clients);
  const total = nombre(synthese?.total_ht);
  const premier = clients[0];
  if (!premier || total === null || total <= 0 || clients.length < 2) return null;

  const part = (nombre(premier.total_ht) ?? 0) / total;
  if (part < 0.5) return null;

  return {
    id: "concentration",
    gravite: part >= 0.7 ? "attention" : "info",
    titre: `${premier.nom} représente ${formatPct(part * 100)} de votre chiffre d'affaires`,
    constat: `${formatEuros(premier.total_ht)} facturés à ce client sur ${formatEuros(total)} au total, sur la période analysée.`,
    consequence:
      "Une dépendance forte à un seul donneur d'ordre fragilise votre activité s'il s'arrête, et peut nourrir une requalification de la relation en contrat de travail.",
    action:
      "Repère de vigilance, pas une règle de droit : si ce contrat vient du même client, faites confirmer votre situation par un expert-comptable.",
    source: "vos factures",
  };
}

/** Factures échues non réglées — la trésorerie qui manque avant même le nouveau contrat. */
function regleImpayes(factures: Facture[], aujourdhui: Date): Recommandation | null {
  const enRetard = liste(factures).filter((f) => {
    if (!f || f.statut === "payee" || f.statut === "brouillon" || f.statut === "annulee") return false;
    const echeance = f.date_echeance;
    if (!echeance) return false;
    const d = new Date(echeance.length <= 10 ? `${echeance}T00:00:00` : echeance);
    return !Number.isNaN(d.getTime()) && d.getTime() < aujourdhui.getTime();
  });

  if (enRetard.length === 0) return null;

  const montant = enRetard.reduce(
    (somme, f) => somme + ((nombre(f.net_a_payer) ?? 0) - (nombre(f.montant_regle) ?? 0)),
    0,
  );
  if (montant <= 0) return null;

  return {
    id: "impayes",
    gravite: "attention",
    titre:
      enRetard.length === 1
        ? "1 facture est échue et non réglée"
        : `${enRetard.length} factures sont échues et non réglées`,
    constat: `${formatEuros(montant)} restent dus au-delà de leur date d'échéance.`,
    consequence:
      "Ce chiffre d'affaires est facturé mais pas encaissé : il compte déjà dans vos plafonds à venir sans être disponible pour payer vos cotisations.",
    action: "Relancez ces factures avant d'ajouter un engagement supplémentaire.",
    source: "vos factures",
  };
}

/** Foyer fiscal incomplet : la moitié des chiffres de l'écran ne peut pas exister. */
function regleFoyer(champs: ChampManquant[]): Recommandation | null {
  if (liste(champs).length === 0) return null;
  return {
    id: "foyer",
    gravite: "attention",
    titre: "Une partie du calcul manque à l'appel",
    constat: `${champs.length} information${champs.length > 1 ? "s" : ""} de votre foyer fiscal ${champs.length > 1 ? "sont absentes" : "est absente"} : ${champs.map((c) => c.libelle.toLowerCase()).join(", ")}.`,
    consequence:
      "L'impôt sur le revenu n'est pas calculé — ni affiché à zéro, ce qui serait trompeur. Le net et le taux effectif présentés sont donc incomplets.",
    action: "Complétez ces champs dans votre profil pour obtenir un net réellement comparable.",
    source: "votre profil",
  };
}

// --------------------------------------------------------------------------- Assemblage

export type EntreesRecommandations = {
  /** Le scénario analysé : la première variante retenue, ou la situation actuelle. */
  scenario: ScenarioCalcule | null;
  ecart: EcartScenario | undefined;
  provision: Provision | undefined;
  projection: Projection;
  synthese: SyntheseFinanciere;
  factures: Facture[];
  champsManquants: ChampManquant[];
  aujourdhui?: Date;
};

/**
 * Toutes les règles applicables, les plus graves d'abord.
 *
 * Aucune règle ne s'invente un fait : chacune renvoie `null` quand la donnée qui la fonde
 * est absente. Un écran sans recommandation est un résultat valable — il vaut mieux que
 * des conseils génériques qui ne regardent pas la situation de l'utilisateur.
 */
export function construireRecommandations(entrees: EntreesRecommandations): Recommandation[] {
  const { scenario, projection, synthese, factures, champsManquants } = entrees;
  const aujourdhui = entrees.aujourdhui ?? new Date();

  const regles: (Recommandation | null)[] = scenario
    ? [
        regleTva(scenario),
        reglePlafond(scenario, projection),
        regleOption(scenario),
        regleEffetMarginal(entrees.ecart),
        regleAcre(scenario),
        regleTresorerie(entrees.provision, synthese),
        regleConcentration(synthese),
        regleImpayes(factures, aujourdhui),
        regleFoyer(champsManquants),
      ]
    : [regleFoyer(champsManquants)];

  return regles
    .filter((r): r is Recommandation => r !== null)
    .sort((a, b) => ORDRE_GRAVITE[a.gravite] - ORDRE_GRAVITE[b.gravite]);
}

export type Verdict = {
  /** La phrase qui répond à la question posée. */
  reponse: string;
  /** Le chiffre décisif, ou `null` s'il n'est pas calculable. */
  chiffre: string | null;
  chiffreLibelle: string;
  /** Nombre de points bloquants et de points de vigilance. */
  bloquants: number;
  vigilances: number;
  gravite: Gravite;
};

/**
 * La réponse d'ensemble, en une phrase.
 *
 * Elle ne dit JAMAIS « signez » ou « ne signez pas » : ce n'est pas une décision que des
 * chiffres peuvent prendre à la place de quelqu'un. Elle dit ce que le scénario rapporte,
 * et combien de points méritent d'être réglés avant de trancher.
 */
export function construireVerdict(
  scenario: ScenarioCalcule | null,
  ecart: EcartScenario | undefined,
  recommandations: Recommandation[],
): Verdict | null {
  if (!scenario) return null;

  const bloquants = recommandations.filter((r) => r.gravite === "critique").length;
  const vigilances = recommandations.filter((r) => r.gravite === "attention").length;
  const deltaNet = nombre(ecart?.deltaNet);
  const netTotal = nombre(scenario.resultat?.revenu_net_estime);

  const chiffre = deltaNet !== null ? formatEuros(deltaNet) : netTotal !== null ? formatEuros(netTotal) : null;
  const chiffreLibelle = deltaNet !== null ? "de net en plus sur l'année" : "de net estimé sur l'année";

  const reponse =
    chiffre === null
      ? "Le net n'est pas calculable tant que votre foyer fiscal n'est pas renseigné."
      : bloquants > 0
        ? `Ce scénario vous rapporte ${chiffre} net, mais ${bloquants === 1 ? "un point bloquant est à régler" : `${bloquants} points bloquants sont à régler`} avant de vous engager.`
        : vigilances > 0
          ? `Ce scénario vous rapporte ${chiffre} net. ${vigilances === 1 ? "Un point mérite" : `${vigilances} points méritent`} votre attention, sans rien empêcher.`
          : `Ce scénario vous rapporte ${chiffre} net, sans conséquence particulière détectée sur votre situation.`;

  return {
    reponse,
    chiffre,
    chiffreLibelle,
    bloquants,
    vigilances,
    gravite: bloquants > 0 ? "critique" : vigilances > 0 ? "attention" : "favorable",
  };
}
