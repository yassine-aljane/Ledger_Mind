// Static mock data for diagnostic (branch B) and dashboard until those APIs exist.

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type DiagnosticQuestion = {
  step: number;
  total: number;
  question: string;
  quickReplies: string[];
};

const diagnosticScript: DiagnosticQuestion[] = [
  {
    step: 1,
    total: 6,
    question:
      "Bonjour ! Je suis LedgerMind. Pas de panique, on va simplement clarifier votre situation ensemble. Depuis quand percevez-vous des revenus liés à votre activité ?",
    quickReplies: ["Moins de 3 mois", "3 à 12 mois", "Plus d'un an", "Je ne sais plus"],
  },
  {
    step: 2,
    total: 6,
    question:
      "Bien noté. Quelles sont vos principales sources de revenus ? (Plusieurs réponses possibles)",
    quickReplies: [
      "Sponsoring / partenariats",
      "Affiliation",
      "Plateformes étrangères (YouTube, TikTok…)",
      "Prestations facturées",
      "Cadeaux en nature",
    ],
  },
  {
    step: 3,
    total: 6,
    question: "Quel est le montant approximatif total perçu sur cette période ?",
    quickReplies: ["Moins de 5 000 €", "5 000 € – 15 000 €", "15 000 € – 30 000 €", "Plus de 30 000 €"],
  },
  {
    step: 4,
    total: 6,
    question: "Émettez-vous déjà des factures pour ces revenus ?",
    quickReplies: ["Oui, systématiquement", "Parfois", "Non, jamais"],
  },
  {
    step: 5,
    total: 6,
    question: "Avez-vous déjà déclaré une partie de ces revenus à l'administration fiscale ?",
    quickReplies: ["Oui, tout", "Partiellement", "Non, rien"],
  },
  {
    step: 6,
    total: 6,
    question:
      "Dernière question : dans quel département résidez-vous ? Cela m'aide à préciser le CFE et vos interlocuteurs locaux.",
    quickReplies: ["Paris (75)", "Rhône (69)", "Autre — je préciserai plus tard"],
  },
];

export async function nextDiagnosticQuestion(step: number): Promise<DiagnosticQuestion | null> {
  await sleep(650);
  return diagnosticScript[step] ?? null;
}

export type DiagnosticResult = {
  situation: {
    activite: string;
    revenus_estimes: string;
    anciennete: string;
    sources: string[];
  };
  statut_actuel: {
    label: string;
    description: string;
  };
  plan: { step: number; title: string; description: string }[];
  regime_recommande: {
    nom: string;
    pourquoi: string;
    plafond: string;
  };
};

export async function fetchDiagnosticResult(): Promise<DiagnosticResult> {
  await sleep(900);
  return {
    situation: {
      activite: "Création de contenu numérique",
      revenus_estimes: "≈ 12 000 € sur les 10 derniers mois",
      anciennete: "10 mois",
      sources: ["Sponsoring", "Plateformes étrangères", "Affiliation"],
    },
    statut_actuel: {
      label: "Non déclaré à ce jour",
      description:
        "Vos revenus n'ont pas encore été rattachés à un statut administratif. Ce n'est pas grave — nous allons régulariser étape par étape.",
    },
    plan: [
      {
        step: 1,
        title: "Créer un statut auto-entrepreneur",
        description: "Inscription en ligne sur le guichet unique (INPI), moins de 20 min.",
      },
      {
        step: 2,
        title: "Obtenir votre numéro SIRET",
        description: "L'INSEE vous l'attribue sous 8 à 15 jours après l'inscription.",
      },
      {
        step: 3,
        title: "Déclarer les revenus déjà perçus",
        description: "Régularisation via la déclaration 2042-C-PRO de l'année concernée.",
      },
      {
        step: 4,
        title: "Mettre en place le suivi mensuel",
        description: "Nous automatisons vos déclarations URSSAF depuis LedgerMind.",
      },
    ],
    regime_recommande: {
      nom: "Micro-BNC",
      pourquoi:
        "Vos revenus (< 77 700 €/an) et la nature de votre activité (prestations intellectuelles) correspondent parfaitement à ce régime. Aucune TVA à collecter, un abattement forfaitaire de 34 %, et une comptabilité ultra-simple.",
      plafond: "77 700 € / an",
    },
  };
}

export type Qualification = {
  categorie: string;
  imposable: boolean;
  tva_applicable: boolean;
  taux_tva: number;
  retenue_source_applicable: boolean;
  taux_rs: number;
  base_legale: string;
  explication_simple: string;
};

export type Calcul = {
  reference: string;
  client: string;
  date: string;
  montant_ht: number;
  tva: number;
  retenue_source: number;
  css: number;
  net_a_percevoir: number;
  provision_conseillee: number;
};

export async function fetchLatestReceipt(): Promise<{ qualification: Qualification; calcul: Calcul }> {
  await sleep(400);
  return {
    qualification: {
      categorie: "Prestation de services locale",
      imposable: true,
      tva_applicable: true,
      taux_tva: 0.19,
      retenue_source_applicable: true,
      taux_rs: 0.1,
      base_legale: "Art. 52 code IRPP/IS",
      explication_simple:
        "Vous facturez une entreprise française pour un développement web : la TVA et une retenue à la source s'appliquent.",
    },
    calcul: {
      reference: "LM-2026-0082",
      client: "Studio Aurore SAS",
      date: "14 nov. 2026",
      montant_ht: 2500,
      tva: 475,
      retenue_source: 250,
      css: 25,
      net_a_percevoir: 2725,
      provision_conseillee: 330,
    },
  };
}
