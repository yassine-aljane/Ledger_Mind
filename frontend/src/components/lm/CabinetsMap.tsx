/**
 * Carte OpenStreetMap des cabinets d'experts-comptables.
 * Leaflet + tuiles OSM (gratuit, sans clé). Marqueurs custom « calculatrice »
 * — pas le pin rouge par défaut.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Calculator, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

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

function expertIcon(selected: boolean) {
  const size = selected ? 44 : 36;
  const bg = selected ? "var(--accent)" : "var(--primary)";
  const fg = selected ? "var(--accent-foreground)" : "var(--primary-foreground)";
  const ring = selected
    ? "box-shadow:0 0 0 3px color-mix(in oklch, var(--accent) 55%, transparent), 0 10px 22px rgba(22,36,31,0.3);"
    : "box-shadow:0 6px 16px rgba(22,36,31,0.22);";
  const html = `
    <div style="
      width:${size}px;height:${size}px;border-radius:10px;
      background:${bg};color:${fg};
      border:2.5px solid #fff;${ring}
      display:grid;place-items:center;
      transform:translateY(-4px);
      transition:transform .15s ease;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="${selected ? 20 : 16}" height="${selected ? 20 : 16}"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect width="16" height="20" x="4" y="2" rx="2"/>
        <line x1="8" x2="16" y1="6" y2="6"/>
        <line x1="16" x2="16" y1="14" y2="18"/>
        <path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/>
        <path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>
      </svg>
    </div>
    <div style="
      width:10px;height:10px;margin:-2px auto 0;background:${bg};
      transform:rotate(45deg);border-right:2px solid #fff;border-bottom:2px solid #fff;
    "></div>
  `;
  return L.divIcon({
    className: "lm-expert-marker",
    html,
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size + 6],
    popupAnchor: [0, -(size + 4)],
  });
}

function FitBounds({
  points,
  center,
}: {
  points: CabinetMapPoint[];
  center?: { lat: number; lon: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) {
      if (center) {
        map.setView([center.lat, center.lon], 12);
      }
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [map, points, center]);
  return null;
}

function FlyToSelected({
  points,
  selectedId,
}: {
  points: CabinetMapPoint[];
  selectedId?: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const hit = points.find((p) => p.id === selectedId);
    if (!hit) return;
    map.flyTo([hit.lat, hit.lon], Math.max(map.getZoom(), 14), { duration: 0.55 });
  }, [map, points, selectedId]);
  return null;
}

export function CabinetsMap({
  cabinets,
  center = null,
  selectedId = null,
  onSelect,
  className,
  heightClassName = "h-[420px]",
}: CabinetsMapProps) {
  // Leaflet touche `window` : attendre le montage client (TanStack Start / SSR).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const plotted = useMemo(
    () => cabinets.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)),
    [cabinets],
  );

  const mapCenter: [number, number] = center
    ? [center.lat, center.lon]
    : plotted[0]
      ? [plotted[0].lat, plotted[0].lon]
      : [46.603354, 1.888334]; // centre France

  if (!mounted) {
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

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card shadow-soft",
        heightClassName,
        className,
      )}
    >
      <div className="relative h-full w-full [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-[color-mix(in_oklch,var(--secondary)_80%,white)] [&_.lm-expert-marker]:border-0 [&_.lm-expert-marker]:bg-transparent">
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-[500] flex items-center justify-between gap-3 border-b border-border/60 bg-card/92 px-3 py-2 text-xs backdrop-blur-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Calculator className="size-3.5 text-primary" />
            Terrain live
          </span>
          <span className="num text-muted-foreground">
            {plotted.length} cabinet{plotted.length > 1 ? "s" : ""}
          </span>
        </div>
        <MapContainer
          center={mapCenter}
          zoom={12}
          scrollWheelZoom
          className="h-full w-full"
          attributionControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={plotted} center={center} />
          <FlyToSelected points={plotted} selectedId={selectedId} />
          {plotted.map((c) => (
            <Marker
              key={`${c.id}-${c.id === selectedId ? "on" : "off"}`}
              position={[c.lat, c.lon]}
              icon={expertIcon(c.id === selectedId)}
              eventHandlers={{
                click: () => onSelect?.(c.id),
              }}
            >
              <Popup>
                <div className="min-w-[200px] max-w-[260px] space-y-2.5 p-0.5 font-sans">
                  <p className="text-sm font-semibold leading-snug text-foreground">{c.nom_cabinet}</p>
                  {c.adresse && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{c.adresse}</p>
                  )}
                  {c.distance_km != null && (
                    <p className="num text-xs text-muted-foreground">{c.distance_km} km</p>
                  )}
                  <CabinetContactLines email={c.email} site_web={c.site_web} telephone={c.telephone} />
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
