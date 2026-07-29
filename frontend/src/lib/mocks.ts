// Shared mock types for dashboard / fiscal receipt until those APIs exist.

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
