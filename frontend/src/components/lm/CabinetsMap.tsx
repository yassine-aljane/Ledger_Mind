/**
 * Carte OpenStreetMap des cabinets d'experts-comptables.
 * Leaflet + tuiles OSM (gratuit, sans clé). Marqueurs custom « calculatrice »
 * — pas le pin rouge par défaut.
 *
 * Ce module reste SANS aucun import Leaflet : il est rendu côté serveur. Le rendu réel
 * de la carte vit dans `CabinetsMapCanvas`, chargé en `lazy()` une fois monté côté
 * client — voir l'en-tête de ce fichier pour le détail.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

const CabinetsMapCanvas = lazy(() => import("@/components/lm/CabinetsMapCanvas"));

export type CabinetMapPoint = {
  id: string;
  nom_cabinet: string;
  adresse?: string | null;
  telephone?: string | null;
  site_web?: string | null;
  email?: string | null;
  lat: number;
  lon: number;
  distance_km?: number | null;
  source?: string;
};

type CabinetsMapProps = {
  cabinets: CabinetMapPoint[];
  center?: { lat: number; lon: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  heightClassName?: string;
};

/** Pastille « introuvable » quand email ou site manquent. */
export function UnfoundBadge({ label = "introuvable" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-fiscal/40 bg-amber-fiscal/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-fiscal">
      {label}
    </span>
  );
}

/** Lignes Email / Site toujours visibles : lien cliquable ou badge introuvable. */
export function CabinetContactLines({
  email,
  site_web,
  telephone,
  className,
}: {
  email?: string | null;
  site_web?: string | null;
  telephone?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rule-label shrink-0 text-muted-foreground">Email</span>
        {email ? (
          <a
            href={`mailto:${email}`}
            className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-teal-dark hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{email}</span>
          </a>
        ) : (
          <UnfoundBadge />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rule-label shrink-0 text-muted-foreground">Site</span>
        {site_web ? (
          <a
            href={site_web.startsWith("http") ? site_web : `https://${site_web}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-teal-dark hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3 shrink-0" />
            <span className="truncate">{site_web.replace(/^https?:\/\//, "")}</span>
          </a>
        ) : (
          <UnfoundBadge />
        )}
      </div>
      {telephone != null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rule-label shrink-0 text-muted-foreground">Tél.</span>
          {telephone ? (
            <a
              href={`tel:${telephone}`}
              className="inline-flex items-center gap-1 font-medium text-teal-dark hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <Phone className="size-3 shrink-0" />
              {telephone}
            </a>
          ) : (
            <UnfoundBadge />
          )}
        </div>
      )}
    </div>
  );
}

/** Réservation d'espace pendant le montage client et le chargement du chunk Leaflet. */
function MapSkeleton({
  heightClassName,
  className,
}: {
  heightClassName: string;
  className?: string;
}) {
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

export function CabinetsMap({
  cabinets,
  center = null,
  selectedId = null,
  onSelect,
  className,
  heightClassName = "h-[420px]",
}: CabinetsMapProps) {
  // Le chunk Leaflet ne doit être demandé qu'après montage : sur le serveur, son simple
  // chargement lèverait « window is not defined ».
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const plotted = useMemo(
    () => cabinets.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)),
    [cabinets],
  );

  if (plotted.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center",
          heightClassName,
          className,
        )}
      >
        <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-5" />
        </div>
        <p className="text-sm font-medium">Aucune position cartographiable</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          Les cabinets trouvés n&apos;ont pas encore de coordonnées précises. La liste reste
          disponible ci-contre.
        </p>
      </div>
    );
  }

  if (!mounted) {
    return <MapSkeleton heightClassName={heightClassName} className={className} />;
  }

  return (
    <Suspense fallback={<MapSkeleton heightClassName={heightClassName} className={className} />}>
      <CabinetsMapCanvas
        cabinets={plotted}
        center={center}
        selectedId={selectedId}
        onSelect={onSelect}
        className={className}
        heightClassName={heightClassName}
      />
    </Suspense>
  );
}
