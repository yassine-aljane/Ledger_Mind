// Dérivation des indicateurs financiers de « Ma situation ».
//
// Tout ce fichier est PUR : il transforme les objets produits par l'espace activité
// (factures, rapports, déclarations — voir facturation-api.ts) en séries et agrégats
// prêts à afficher. Aucun appel réseau, aucun état React : le dashboard peut donc
// recalculer à volonté quand l'utilisateur change de période, et ces fonctions
// restent testables isolément.

import type { Declaration, Facture, RapportActivite } from "@/lib/facturation-api";

// ------------------------------------------------------------------------------- Périodes

/** Fenêtre d'analyse choisie par l'utilisateur, appliquée à TOUT l'écran à la fois. */
export type Periode = "3m" | "12m" | "annee" | "tout";

export const PERIODES: { id: Periode; label: string; aide: string }[] = [
  { id: "3m", label: "3 mois", aide: "Les trois derniers mois glissants" },
  { id: "12m", label: "12 mois", aide: "Les douze derniers mois glissants" },
  { id: "annee", label: "Année civile", aide: "Du 1ᵉʳ janvier à aujourd'hui" },
  { id: "tout", label: "Tout", aide: "Depuis votre première facture" },
];

/** Nombre de mois couverts par une période — `null` pour « tout l'historique ». */
function moisCouverts(periode: Periode, maintenant: Date): number | null {
  switch (periode) {
    case "3m":
      return 3;
    case "12m":
      return 12;
    case "annee":
      return maintenant.getMonth() + 1;
    case "tout":
      return null;
  }
}

// --------------------------------------------------------------------------------- Types

export type PointMensuel = {
  /** Clé triable « AAAA-MM ». */
  cle: string;
  /** Étiquette courte pour l'axe (« janv. »). */
  label: string;
  /** Étiquette complète pour l'infobulle (« janvier 2026 »). */
  labelLong: string;
  prestations_ht: number;
  ventes_ht: number;
  total_ht: number;
  total_ttc: number;
  total_tva: number;
  nb_factures: number;
};

export type ClientAgrege = { nom: string; total_ht: number; nb_factures: number };

export type SyntheseFinanciere = {
  /** Série mensuelle continue (mois sans facture inclus à zéro) sur la période choisie. */
  points: PointMensuel[];
  total_ht: number;
  total_ttc: number;
  total_tva: number;
  prestations_ht: number;
  ventes_ht: number;
  nb_factures: number;
  panier_moyen: number;
  /** Variation du CA HT face à la période précédente de même longueur. `null` si pas d'historique. */
  delta_ht_pct: number | null;
  /** Variation du nombre de factures, même règle. */
  delta_factures_pct: number | null;
  meilleur_mois: PointMensuel | null;
  /** CA HT du mois calendaire en cours, quelle que soit la période affichée. */
  ca_mois_en_cours: number;
  /** Cinq premiers clients par CA HT sur la période. */
  clients: ClientAgrege[];
  /** Bornes réelles de la fenêtre analysée, au format ISO court. */
  debut: string;
  fin: string;
};

// ----------------------------------------------------------------------------- Utilitaires

function cleMois(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Les dates de l'API arrivent en « AAAA-MM-JJ » ; on tolère aussi un ISO complet. */
function parseDate(valeur: string): Date | null {
  const d = new Date(valeur.length <= 10 ? `${valeur}T00:00:00` : valeur);
  return Number.isNaN(d.getTime()) ? null : d;
}

function moisLabel(d: Date, format: "court" | "long"): string {
  return d.toLocaleDateString(
    "fr-FR",
    format === "court" ? { month: "short" } : { month: "long", year: "numeric" },
  );
}

function pointVide(d: Date): PointMensuel {
  return {
    cle: cleMois(d),
    label: moisLabel(d, "court"),
    labelLong: moisLabel(d, "long"),
    prestations_ht: 0,
    ventes_ht: 0,
    total_ht: 0,
    total_ttc: 0,
    total_tva: 0,
    nb_factures: 0,
  };
}

/** Ventile le HT d'une facture entre prestations et ventes à partir de ses lignes. */
function ventilerFacture(f: Facture): { prestations: number; ventes: number } {
  let prestations = 0;
  let ventes = 0;
  for (const l of f.lignes) {
    const ht = (l.quantite ?? 0) * (l.prix_unitaire_ht ?? 0);
    if (l.categorie === "vente") ventes += ht;
    else prestations += ht;
  }
  // Si les lignes ne reconstituent pas le total (arrondis serveur, remise…), on fait
  // confiance au total facturé et on répartit au prorata plutôt que d'afficher un
  // graphique dont la somme des segments contredit le KPI juste à côté.
  const somme = prestations + ventes;
  if (somme > 0 && Math.abs(somme - f.total_ht) > 0.01) {
    const ratio = f.total_ht / somme;
    return { prestations: prestations * ratio, ventes: ventes * ratio };
  }
  if (somme === 0) return { prestations: f.total_ht, ventes: 0 };
  return { prestations, ventes };
}

/** Premier jour du mois, `decalage` mois avant `reference`. */
function debutMois(reference: Date, decalage = 0): Date {
  return new Date(reference.getFullYear(), reference.getMonth() - decalage, 1);
}

// ------------------------------------------------------------------------------- Synthèse

function agregerFenetre(factures: Facture[], debut: Date, fin: Date) {
  let total_ht = 0;
  let total_ttc = 0;
  let total_tva = 0;
  let prestations_ht = 0;
  let ventes_ht = 0;
  let nb_factures = 0;
  const parMois = new Map<string, PointMensuel>();
  const parClient = new Map<string, ClientAgrege>();

  for (const f of factures) {
    const d = parseDate(f.date_emission);
    if (!d || d < debut || d > fin) continue;

    const { prestations, ventes } = ventilerFacture(f);
    total_ht += f.total_ht;
    total_ttc += f.total_ttc;
    total_tva += f.total_tva;
    prestations_ht += prestations;
    ventes_ht += ventes;
    nb_factures += 1;

    const cle = cleMois(d);
    const point = parMois.get(cle) ?? pointVide(d);
    point.prestations_ht += prestations;
    point.ventes_ht += ventes;
    point.total_ht += f.total_ht;
    point.total_ttc += f.total_ttc;
    point.total_tva += f.total_tva;
    point.nb_factures += 1;
    parMois.set(cle, point);

    const nom = f.client?.nom?.trim() || "Client non nommé";
    const c = parClient.get(nom) ?? { nom, total_ht: 0, nb_factures: 0 };
    c.total_ht += f.total_ht;
    c.nb_factures += 1;
    parClient.set(nom, c);
  }

  return {
    total_ht,
    total_ttc,
    total_tva,
    prestations_ht,
    ventes_ht,
    nb_factures,
    parMois,
    parClient,
  };
}

/**
 * Construit toute la synthèse affichée par « Ma situation » pour une période donnée.
 *
 * `maintenant` est injectable pour rendre le calcul déterministe en test.
 */
export function construireSynthese(
  factures: Facture[],
  periode: Periode,
  maintenant: Date = new Date(),
): SyntheseFinanciere {
  const finFenetre = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth() + 1,
    0,
    23,
    59,
    59,
  );

  // Bornes de la fenêtre courante. « Tout » remonte à la première facture connue.
  const nbMois = moisCouverts(periode, maintenant);
  let debutFenetre: Date;
  if (nbMois == null) {
    const dates = factures
      .map((f) => parseDate(f.date_emission))
      .filter((d): d is Date => d != null);
    debutFenetre = dates.length
      ? debutMois(new Date(Math.min(...dates.map((d) => d.getTime()))))
      : debutMois(maintenant, 11);
  } else {
    debutFenetre = debutMois(maintenant, nbMois - 1);
  }

  const courant = agregerFenetre(factures, debutFenetre, finFenetre);

  // Série mensuelle continue : un mois sans facture doit apparaître à zéro, sinon
  // le graphique masque les creux — exactement l'information qu'on vient y chercher.
  const points: PointMensuel[] = [];
  const curseur = new Date(debutFenetre);
  while (curseur <= finFenetre) {
    points.push(courant.parMois.get(cleMois(curseur)) ?? pointVide(curseur));
    curseur.setMonth(curseur.getMonth() + 1);
  }

  // Période précédente de même longueur, pour les deltas.
  let delta_ht_pct: number | null = null;
  let delta_factures_pct: number | null = null;
  if (nbMois != null) {
    const finPrec = new Date(debutFenetre.getTime() - 1);
    const debutPrec = debutMois(debutFenetre, nbMois);
    const precedent = agregerFenetre(factures, debutPrec, finPrec);
    if (precedent.total_ht > 0) {
      delta_ht_pct = ((courant.total_ht - precedent.total_ht) / precedent.total_ht) * 100;
    }
    if (precedent.nb_factures > 0) {
      delta_factures_pct =
        ((courant.nb_factures - precedent.nb_factures) / precedent.nb_factures) * 100;
    }
  }

  const meilleur_mois = points.reduce<PointMensuel | null>(
    (best, p) => (p.total_ht > 0 && (!best || p.total_ht > best.total_ht) ? p : best),
    null,
  );

  const clients = [...courant.parClient.values()]
    .sort((a, b) => b.total_ht - a.total_ht)
    .slice(0, 5);

  return {
    points,
    total_ht: courant.total_ht,
    total_ttc: courant.total_ttc,
    total_tva: courant.total_tva,
    prestations_ht: courant.prestations_ht,
    ventes_ht: courant.ventes_ht,
    nb_factures: courant.nb_factures,
    panier_moyen: courant.nb_factures > 0 ? courant.total_ht / courant.nb_factures : 0,
    delta_ht_pct,
    delta_factures_pct,
    meilleur_mois,
    ca_mois_en_cours: courant.parMois.get(cleMois(maintenant))?.total_ht ?? 0,
    clients,
    debut: debutFenetre.toISOString().slice(0, 10),
    fin: finFenetre.toISOString().slice(0, 10),
  };
}

// ----------------------------------------------------------------------------- Seuil / régime

export type EtatSeuil = {
  /** Part du plafond consommée, en %. Peut dépasser 100. */
  pct: number;
  plafond: number | null;
  consomme: number;
  /** Sévérité : pilote la couleur de la jauge ET l'icône/texte qui l'accompagne. */
  niveau: "ok" | "attention" | "serieux" | "critique";
  message: string;
  /** D'où vient le chiffre — on ne présente jamais une estimation comme une donnée serveur. */
  provenance: "rapport" | "factures" | "inconnu";
};

/** « 77 700 € » / « 77.700 EUR » → 77700. Renvoie `null` si rien d'exploitable. */
export function parsePlafond(valeur: string | null | undefined): number | null {
  if (!valeur) return null;
  const chiffres = valeur.replace(/[^\d]/g, "");
  if (!chiffres) return null;
  const n = parseInt(chiffres, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function niveauDepuisPct(pct: number): EtatSeuil["niveau"] {
  if (pct >= 100) return "critique";
  if (pct >= 85) return "serieux";
  if (pct >= 65) return "attention";
  return "ok";
}

function messageSeuil(niveau: EtatSeuil["niveau"]): string {
  switch (niveau) {
    case "critique":
      return "Plafond dépassé : le changement de régime devient obligatoire. À confirmer avec un expert-comptable.";
    case "serieux":
      return "Vous approchez du plafond. Anticipez le passage de régime avant la fin de l'exercice.";
    case "attention":
      return "Plus de deux tiers du plafond consommés. Surveillez le rythme des prochains mois.";
    case "ok":
      return "Vous restez confortablement sous le plafond de votre régime.";
  }
}

/**
 * Position face au plafond du régime.
 *
 * Le rapport d'activité fait foi quand il existe (le serveur connaît le plafond exact
 * du régime) ; sinon on estime à partir du CA facturé et du plafond affiché sur le
 * profil, et on le signale via `provenance`.
 */
export function etatSeuil(
  rapport: RapportActivite | null,
  synthese: SyntheseFinanciere,
  regimePlafond: string | null | undefined,
): EtatSeuil {
  if (rapport && Number.isFinite(rapport.position_vs_seuil_pct)) {
    const pct = rapport.position_vs_seuil_pct;
    const niveau = niveauDepuisPct(pct);
    return {
      pct,
      plafond: parsePlafond(regimePlafond),
      consomme: rapport.total_ht,
      niveau,
      message: messageSeuil(niveau),
      provenance: "rapport",
    };
  }

  const plafond = parsePlafond(regimePlafond);
  if (plafond) {
    const pct = (synthese.total_ht / plafond) * 100;
    const niveau = niveauDepuisPct(pct);
    return {
      pct,
      plafond,
      consomme: synthese.total_ht,
      niveau,
      message: messageSeuil(niveau),
      provenance: "factures",
    };
  }

  return {
    pct: 0,
    plafond: null,
    consomme: synthese.total_ht,
    niveau: "ok",
    message: "Plafond de régime inconnu : générez un rapport d'activité pour le situer.",
    provenance: "inconnu",
  };
}

// ------------------------------------------------------------------------ Santé du dossier

export type IndiceSante = {
  /** Score sur 100, volontairement grossier : c'est un feu de circulation, pas une note. */
  score: number;
  niveau: "ok" | "attention" | "serieux";
  criteres: { label: string; acquis: boolean; detail: string }[];
};

/**
 * Un indicateur d'avancement du dossier : ce qui est fait, ce qui manque.
 *
 * Volontairement basé sur des faits vérifiables (un rapport existe, une déclaration a
 * été relue…) et jamais sur une appréciation du modèle — l'utilisateur doit pouvoir
 * remonter de chaque point à l'action qui l'a produit.
 */
export function indiceSante(
  synthese: SyntheseFinanciere,
  rapports: RapportActivite[],
  declarations: Declaration[],
  seuil: EtatSeuil,
): IndiceSante {
  const declarationRelue = declarations.some((d) => d.statut !== "brouillon");
  const criteres = [
    {
      label: "Facturation active",
      acquis: synthese.nb_factures > 0,
      detail:
        synthese.nb_factures > 0
          ? `${synthese.nb_factures} facture${synthese.nb_factures > 1 ? "s" : ""} sur la période`
          : "Aucune facture émise sur la période",
    },
    {
      label: "Rapport d'activité",
      acquis: rapports.length > 0,
      detail: rapports.length > 0 ? "Consolidation disponible" : "Jamais généré",
    },
    {
      label: "Déclaration préparée",
      acquis: declarations.length > 0,
      detail: declarations.length > 0 ? "Au moins une déclaration prête" : "Aucune déclaration",
    },
    {
      label: "Déclaration relue",
      acquis: declarationRelue,
      detail: declarationRelue ? "Montants confirmés par vos soins" : "Relecture à faire",
    },
    {
      label: "Sous le plafond",
      acquis: seuil.niveau === "ok" || seuil.niveau === "attention",
      detail: `${Math.round(seuil.pct)} % du plafond consommé`,
    },
  ];

  const acquis = criteres.filter((c) => c.acquis).length;
  const score = Math.round((acquis / criteres.length) * 100);
  return {
    score,
    niveau: score >= 80 ? "ok" : score >= 50 ? "attention" : "serieux",
    criteres,
  };
}

// --------------------------------------------------------------------------------- Format

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (abs >= 10_000) return `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

export function formatEuros(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

export function formatPct(n: number): string {
  const signe = n > 0 ? "+" : "";
  return `${signe}${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}
