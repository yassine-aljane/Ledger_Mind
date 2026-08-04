/**
 * Carte des cabinets — enveloppe CLIENT UNIQUEMENT.
 *
 * Leaflet lit `window` dès le chargement de son module. Sous TanStack Start, qui rend
 * d'abord côté serveur, un simple `import` en tête de fichier suffit donc à faire
 * échouer le rendu — un garde `if (mounted)` À L'INTÉRIEUR du composant arrive trop
 * tard, le module étant déjà évalué.
 *
 * D'où ce découpage : l'implémentation vit dans `CabinetsMapImpl` et n'est chargée
 * qu'après le montage dans le navigateur, par un `import()` différé. Le serveur ne
 * voit jamais Leaflet.
 *
 * Les composants sans carte (`CabinetContactLines`, `UnfoundBadge`, le type
 * `CabinetMapPoint`) vivent dans `@/components/lm/cabinets` et s'importent librement.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { CabinetMapPoint } from "@/components/lm/cabinets";

type CabinetsMapProps = {
  cabinets: CabinetMapPoint[];
  center?: { lat: number; lon: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  heightClassName?: string;
};

// `lazy` n'évalue le module qu'au premier rendu du composant — jamais à l'import.
const CarteLeaflet = lazy(() => import("@/components/lm/CabinetsMapImpl"));

/** Bloc de même gabarit que la carte, affiché avant son chargement. */
function Placeholder({
  className,
  heightClassName,
}: Pick<CabinetsMapProps, "className" | "heightClassName">) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-2xl border border-border bg-secondary/40",
        heightClassName,
        className,
      )}
      aria-hidden
    />
  );
}

export function CabinetsMap(props: CabinetsMapProps) {
  const { className, heightClassName = "h-[420px]" } = props;
  // Le premier rendu client doit reproduire celui du serveur, sans quoi l'hydratation
  // signale une divergence : on n'affiche la carte qu'au rendu suivant.
  const [monte, setMonte] = useState(false);
  useEffect(() => setMonte(true), []);

  const attente = <Placeholder className={className} heightClassName={heightClassName} />;
  if (!monte) return attente;

  return (
    <Suspense fallback={attente}>
      <CarteLeaflet {...props} heightClassName={heightClassName} />
    </Suspense>
  );
}
