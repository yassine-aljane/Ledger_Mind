/**
 * Types et composants de cabinets SANS dépendance à Leaflet.
 *
 * Séparés de `CabinetsMap` à dessein : Leaflet touche `window` dès le chargement de
 * son module, ce qui casse le rendu serveur. Tout ce qui n'a pas besoin de la carte
 * vit donc ici, et les écrans peuvent l'importer sans entraîner Leaflet dans le SSR.
 */

import { ExternalLink, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

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
