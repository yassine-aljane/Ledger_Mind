import type { Roadmap } from "@/components/lm/RoadmapView";
import type { Calcul, Qualification } from "@/lib/mocks";

/**
 * Données de démonstration — utilisées UNIQUEMENT dans les aperçus verrouillés (Free).
 *
 * Elles alimentent les VRAIS composants d'affichage (`RoadmapView`, `FiscalReceipt`…), pas des
 * maquettes parallèles : l'aperçu montre donc exactement l'écran qui sera débloqué, et il suit
 * automatiquement toute évolution de ces composants.
 *
 * Elles sont typées avec les types réels de l'application. C'est volontaire et contraignant :
 * si un contrat d'affichage change, la démo casse à la compilation au lieu de dériver en
 * silence vers un aperçu qui ne ressemble plus au produit.
 *
 * Elles ne transitent jamais par le réseau et ne doivent jamais alimenter un écran réel — un
 * chiffre inventé présenté comme la donnée de l'utilisateur serait un mensonge.
 */

export const DEMO_ROADMAP: Roadmap = {
  parcours: "creation",
  regime_recommande: "Micro-BNC",
  bandeau: {
    type: "Diagnostic sans SIREN",
    titre: "Vous êtes à 6 400 € du seuil de franchise en base de TVA",
    texte:
      "Votre activité de prestation de services est durable au sens fiscal. Le régime micro-BNC reste optimal cette année, à condition de surveiller le seuil de TVA au trimestre.",
  },
  etapes: [
    {
      id: "guichet-unique",
      titre: "Déclarer le début d'activité sur le Guichet unique",
      detail: "Formalité INPI, délai 8 jours après le premier encaissement.",
      lien: "https://procedures.inpi.fr",
      duree: "Sous 8 jours",
      obligatoire: true,
    },
    {
      id: "compte-dedie",
      titre: "Ouvrir un compte bancaire dédié",
      detail: "Obligatoire au-delà de 10 000 € de recettes deux années de suite.",
      duree: "Ce trimestre",
      obligatoire: false,
    },
    {
      id: "mention-franchise",
      titre: "Mettre en place la mention de franchise sur vos factures",
      detail: "« TVA non applicable, art. 293 B du CGI »",
      duree: "Immédiat",
      obligatoire: true,
    },
  ],
  seuils_profil: [
    { label: "Franchise en base de TVA", seuil: 39100, position: 32700, seuil_plein: 39100 },
    { label: "Plafond micro-BNC", seuil: 77700, position: 32700, seuil_plein: 77700 },
  ],
  legal_sources: [
    {
      label: "Plafond micro-BNC",
      valeur: "77 700 €",
      annee: "2025",
      source: "BOI-BNC-DECLA-20",
      date_verif: "2025-01-15",
    },
    {
      label: "Franchise en base de TVA",
      valeur: "39 100 €",
      annee: "2025",
      source: "CGI art. 293 B",
      date_verif: "2025-01-01",
    },
  ],
  meta: { fraicheur: { perime: false, max_days: 365 } },
};

/** Qualification et calcul du reçu fiscal de démonstration, cohérents avec DEMO_INVOICE. */
export const DEMO_QUALIFICATION: Qualification = {
  categorie: "BNC — prestations de services",
  imposable: true,
  tva_applicable: false,
  taux_tva: 0,
  retenue_source_applicable: false,
  taux_rs: 0,
  base_legale: "Art. 93 CGI — BNC",
  explication_simple:
    "Activité durable (récurrence supérieure à 6 mois), clientèle multiple et moyens matériels dédiés : le régime micro-BNC s'applique.",
};

export const DEMO_CALCUL: Calcul = {
  reference: "F-2025-0184",
  client: "Atelier Verdier SAS",
  date: "4 mars 2025",
  montant_ht: 3630,
  tva: 726,
  retenue_source: 0,
  css: 36.3,
  net_a_percevoir: 4319.7,
  provision_conseillee: 799,
};

/* ------------------------------ Capture : pièces analysées ----------------------------- */

export type DemoInvoice = {
  invoice_number: string;
  issuer_name: string;
  issuer_tax_id: string;
  client_name: string;
  issue_date: string;
  line_items: { description: string; quantity: number; unit_price: number; total: number }[];
  subtotal_ht: number;
  vat_amount: number;
  total_ttc: number;
  currency: string;
  paid: boolean;
  due_date: string;
  payment_terms_days: number;
  expense_category: string;
  incoherences: string[];
  payment_days_until: number;
  saved: boolean;
};

export type DemoBankTransfer = {
  transfer_reference: string;
  execution_date: string;
  amount: number;
  currency: string;
  direction: string;
  sender_name: string;
  receiver_name: string;
  bank_name: string;
  motif: string;
  transfer_type: string;
};

export const DEMO_INVOICE: DemoInvoice = {
  invoice_number: "F-2025-0184",
  issuer_name: "Studio Marge Nord",
  issuer_tax_id: "FR40483912741",
  client_name: "Atelier Verdier SAS",
  issue_date: "2025-03-04",
  line_items: [
    { description: "Direction artistique — mars", quantity: 6, unit_price: 480, total: 2880 },
    { description: "Licence d'utilisation 12 mois", quantity: 1, unit_price: 750, total: 750 },
  ],
  subtotal_ht: 3630,
  vat_amount: 726,
  total_ttc: 4356,
  currency: "EUR",
  paid: false,
  due_date: "2025-04-03",
  payment_terms_days: 30,
  expense_category: "Prestations créatives",
  incoherences: ["TVA facturée alors que le profil est en franchise en base"],
  payment_days_until: 12,
  saved: true,
};

export const DEMO_TRANSFER: DemoBankTransfer = {
  transfer_reference: "VIR-889201",
  execution_date: "2025-03-11",
  amount: 4356,
  currency: "EUR",
  direction: "Crédit",
  sender_name: "Atelier Verdier SAS",
  receiver_name: "Studio Marge Nord",
  bank_name: "Qonto",
  motif: "Règlement facture F-2025-0184",
  transfer_type: "SEPA",
};

/** Projections du simulateur, issues du même diagnostic. */
export const DEMO_SCENARIOS: { titre: string; impact: string; action: string }[] = [
  {
    titre: "Croissance +30 %",
    impact: "Dépassement du seuil TVA en septembre",
    action: "Anticiper l'assujettissement",
  },
  { titre: "Stabilité", impact: "Maintien micro-BNC", action: "Aucune démarche" },
];

export const DEMO_ANALYSE_JURIDIQUE = {
  seuil_ca_applicable: "77 700 €",
  ratio_utilise: "42 %",
  duree_activite: "11 mois",
  motifs: ["Récurrence des missions", "Clientèle multiple", "Moyens matériels dédiés"],
};

/** Écritures d'historique de démonstration, cohérentes avec la facture ci-dessus. */
export const DEMO_HISTORIQUE: {
  reference: string;
  client: string;
  date: string;
  ht: number;
  net: number;
  statut: "Qualifié" | "En revue";
}[] = [
  { reference: "F-2025-0184", client: "Atelier Verdier SAS", date: "04 mars", ht: 3630, net: 4356, statut: "Qualifié" },
  { reference: "F-2025-0179", client: "Maison Lombard", date: "22 févr.", ht: 2100, net: 2100, statut: "Qualifié" },
  { reference: "F-2025-0174", client: "Cadeau — Marque Nord", date: "09 févr.", ht: 450, net: 450, statut: "En revue" },
  { reference: "F-2025-0168", client: "Studio Kervadec", date: "28 janv.", ht: 5200, net: 5200, statut: "Qualifié" },
];

/* ------------------------------------ Profil fiscal ----------------------------------- */

/** Profil de démonstration, cohérent avec le diagnostic et la facture ci-dessus. */
export const DEMO_PROFIL: {
  section: string;
  champs: { label: string; valeur: string; mono?: boolean }[];
}[] = [
  {
    section: "Identité fiscale",
    champs: [
      { label: "Dénomination", valeur: "Studio Marge Nord" },
      { label: "SIRET", valeur: "84291750500018", mono: true },
      { label: "Code APE", valeur: "7410Z — Activités spécialisées de design", mono: false },
      { label: "Forme juridique", valeur: "Entreprise individuelle" },
    ],
  },
  {
    section: "Régime & plafonds",
    champs: [
      { label: "Régime", valeur: "Micro-BNC" },
      { label: "Catégorie", valeur: "BNC — prestations de services" },
      { label: "Plafond applicable", valeur: "77 700 €", mono: true },
      { label: "CA réalisé", valeur: "32 700 €", mono: true },
      { label: "TVA", valeur: "Franchise en base (art. 293 B)" },
    ],
  },
  {
    section: "Connexions & accès",
    champs: [
      { label: "Banque", valeur: "Qonto — synchronisée" },
      { label: "Expert-comptable", valeur: "Cabinet Aurore — accès lecture" },
      { label: "Export comptable", valeur: "Format FEC (DGFiP)" },
    ],
  },
];
