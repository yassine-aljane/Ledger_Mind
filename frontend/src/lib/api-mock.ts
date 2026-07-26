// API layer — real HTTP calls to the FastAPI backend.
// Diagnostic/dashboard helpers below use static mock data until those endpoints are wired.

export type SiretVerification = {
  status: "verified" | "not_verified";
  siret: string;
  denomination: string | null;
  legal_form: string | null;
  ape_code: string | null;
  activity_declared: string | null;
  creation_date: string | null;
  administrative_status: "actif" | "inactif" | null;
  mismatches: {
    field: string;
    sirene_value: string | null;
    rne_value: string | null;
    note: string;
  }[];
  explanation: string;
  next_action: string | null;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

export async function verifySiret(siret: string): Promise<SiretVerification> {
  const response = await fetch(`${API_BASE}/api/verification/siret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ siret: siret.replace(/\s/g, "") }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Verification failed: ${errorText}`);
  }

  return await response.json();
}

export async function ocrExtractSiret(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}/api/verification/ocr-siret`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Erreur inconnue." }));
    throw new Error(err.detail ?? `Erreur ${response.status}`);
  }

  const data = await response.json();
  return data.siret as string;
}

// -------- Diagnostic chatbot (branch B) --------

export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  quickReplies?: string[];
  ts: string;
};

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

// -------- Diagnostic result --------

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

// -------- Onboarding agent (branch A) --------

export type InfluencerProfile = {
  activity_types: string[];
  revenue_sources: string[];
  currencies: string[];
  estimated_monthly_revenue: string | null;
  revenue_variability: "stable" | "spiky" | "unknown" | null;
  invoices_already_issued: boolean | null;
  first_income_date: string | null;
  has_recurring_contracts: boolean | null;
  in_kind_gifts: boolean | null;
  international_clients: boolean | null;
};

export const emptyInfluencerProfile: InfluencerProfile = {
  activity_types: [],
  revenue_sources: [],
  currencies: [],
  estimated_monthly_revenue: null,
  revenue_variability: null,
  invoices_already_issued: null,
  first_income_date: null,
  has_recurring_contracts: null,
  in_kind_gifts: null,
  international_clients: null,
};

export type OnboardingTurnResult = {
  profile: InfluencerProfile;
  next_question: string | null;
  quick_replies: string[];
  is_done: boolean;
  completeness: number;
};

export async function nextOnboardingTurn(
  profile: InfluencerProfile,
  lastQuestion: string | null,
  lastAnswer: string | null,
): Promise<OnboardingTurnResult> {
  const res = await fetch(`${API_BASE}/api/onboarding/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile,
      last_question: lastQuestion,
      last_answer: lastAnswer,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// -------- Dashboard --------

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

// -------- helpers --------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
