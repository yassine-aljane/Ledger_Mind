/**
 * Affectation des teintes aux séries de scénarios.
 *
 * Isolé des composants pour deux raisons : le rafraîchissement à chaud de Vite exige qu'un
 * module de composants n'exporte que des composants, et surtout l'ordre des teintes est une
 * règle, pas un détail de rendu — elle mérite un module qu'on peut lire seul.
 *
 * ORDRE FIXE, JAMAIS CYCLÉ. L'index d'un scénario détermine sa teinte et ne change plus :
 * retirer une variante ne doit pas repeindre les survivantes, sans quoi le lecteur croit
 * comparer autre chose. Au-delà de quatre séries, l'écran refuse d'en ajouter plutôt que de
 * réutiliser une couleur — les quatre pas `--dv-serie-1..4` sont validés en toutes paires
 * (voir `styles.css`), un cinquième ne le serait pas.
 */

export const SERIES = [
  "var(--color-dv-serie-1)",
  "var(--color-dv-serie-2)",
  "var(--color-dv-serie-3)",
  "var(--color-dv-serie-4)",
] as const;

export const MAX_SERIES = SERIES.length;

export function couleurSerie(index: number): string {
  return SERIES[Math.min(Math.max(index, 0), SERIES.length - 1)];
}

/** Parts de la décomposition : mêmes pas validés, rôle différent, ordre fixe également. */
export const COULEUR_PART = {
  cotisations: "var(--color-dv-serie-3)",
  ir: "var(--color-dv-serie-4)",
  cfp: "var(--color-dv-serie-2)",
  net: "var(--color-dv-serie-1)",
} as const;
