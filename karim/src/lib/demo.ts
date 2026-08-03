import type { Invoice, Roadmap, BankTransfer } from "./types";

/** Données de démonstration — utilisées UNIQUEMENT dans les aperçus verrouillés (Free). */

export const DEMO_ROADMAP: Roadmap = {
  bandeau: {
    type: "Diagnostic sans SIREN",
    titre: "Vous êtes à 6 400 € du seuil de franchise en base de TVA",
    texte:
      "Votre activité de prestation de services est durable au sens fiscal. Le régime micro-BNC reste optimal cette année, à condition de surveiller le seuil de TVA au trimestre.",
  },
  regime_recommande: "Micro-BNC",
  categorie: "BNC — prestations de services",
  durabilite: "Activité durable (récurrence > 6 mois)",
  parcours: "Création d'entreprise individuelle",
  analyse_juridique: {
    seuil_ca_applicable: "77 700 €",
    ratio_utilise: "42 %",
    duree_activite: "11 mois",
    motifs: ["Récurrence des missions", "Clientèle multiple", "Moyens matériels dédiés"],
  },
  seuils_profil: [
    { libelle: "Franchise en base de TVA", plafond: "39 100 €", realise: "32 700 €", statut: "Sous le seuil" },
    { libelle: "Plafond micro-BNC", plafond: "77 700 €", realise: "32 700 €", statut: "Confortable" },
  ],
  etapes: [
    {
      titre: "Déclarer le début d'activité sur le Guichet unique",
      description: "Formalité INPI, délai 8 jours après le premier encaissement.",
      echeance: "Sous 8 jours",
      priorite: "Haute",
    },
    {
      titre: "Ouvrir un compte bancaire dédié",
      description: "Obligatoire au-delà de 10 000 € de recettes deux années de suite.",
      echeance: "Ce trimestre",
      priorite: "Moyenne",
    },
    {
      titre: "Mettre en place la mention de franchise sur vos factures",
      description: "« TVA non applicable, art. 293 B du CGI »",
      echeance: "Immédiat",
      priorite: "Haute",
    },
  ],
  scenarios: [
    { titre: "Croissance +30 %", impact: "Dépassement du seuil TVA en septembre", action: "Anticiper l'assujettissement" },
    { titre: "Stabilité", impact: "Maintien micro-BNC", action: "Aucune démarche" },
  ],
  legal_sources: [
    { titre: "BOI-BNC-DECLA-20", url: "https://bofip.impots.gouv.fr", date_publication: "2025-01-15" },
    { titre: "CGI art. 293 B", url: "https://www.legifrance.gouv.fr", date_publication: "2025-01-01" },
  ],
  meta: { annee_reference: 2025, fraicheur: "Barèmes à jour" },
};

export const DEMO_INVOICE: Invoice = {
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

export const DEMO_TRANSFER: BankTransfer = {
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
