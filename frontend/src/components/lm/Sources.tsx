/**
 * Sources d'une réponse de l'agent pédagogique.
 *
 * Une réponse fiscale sans sa source n'est pas vérifiable : chaque extrait réellement utilisé est
 * affiché, avec son rang d'autorité (Légifrance, BOFiP et BOSS font foi — les guides sont
 * secondaires) et son score de similarité. Cliquer une source déplie l'extrait exact qui a servi,
 * pour que l'utilisateur puisse contrôler ce que l'agent a lu.
 */

import { ExternalLink, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatSource } from "@/lib/guidance-api";

/** Sources faisant autorité : texte de loi et doctrine administrative opposable. */
const AUTORITE = /l[ée]gifrance|bofip|boss/i;

export function Sources({
  sources,
  fraicheur,
  bofipLive,
}: {
  sources?: ChatSource[] | null;
  fraicheur?: boolean;
  bofipLive?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const list = sources ?? [];
  if (list.length === 0 && !fraicheur && !bofipLive) return null;

  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      {bofipLive && (
        <p className="mb-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs leading-snug text-info-ink">
          Repli BOFiP en direct : le corpus local était insuffisant, la réponse est ancrée sur la
          doctrine à jour.
        </p>
      )}

      {list.length > 0 && (
        <>
          <p className="rule-label mb-2 text-muted-foreground">Sources</p>
          <div className="flex flex-wrap gap-2">
            {list.map((s, i) => {
              const autorite = AUTORITE.test(s.source ?? "");
              const score = s.score != null ? Math.max(0, Math.min(1, Number(s.score))) : null;
              const actif = open === i;
              return (
                <button
                  key={`${s.url}-${i}`}
                  onClick={() => setOpen(actif ? null : i)}
                  title="Voir l'extrait utilisé"
                  aria-expanded={actif}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-200",
                    autorite
                      ? "border-success/30 bg-success/10 text-success-ink"
                      : "border-border bg-secondary/60 text-muted-foreground",
                    actif ? "ring-1 ring-ring/50" : "hover:border-ink/40",
                  )}
                >
                  <span className="font-medium">{s.source}</span>
                  {score != null && (
                    <>
                      <span className="h-1 w-8 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full bg-current"
                          style={{ width: `${Math.round(score * 100)}%` }}
                        />
                      </span>
                      <span className="num opacity-60">{score.toFixed(2)}</span>
                    </>
                  )}
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-70 transition-opacity hover:opacity-100"
                      aria-label={`Ouvrir ${s.source}`}
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </button>
              );
            })}
          </div>

          {open != null && list[open] && (
            <div className="animate-fade-in mt-2.5 rounded-lg border border-border bg-secondary/50 p-3">
              <p className="text-xs font-medium">{list[open].titre || list[open].source}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {list[open].texte || list[open].extrait || "Extrait non disponible."}
              </p>
            </div>
          )}
        </>
      )}

      {fraicheur && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-snug text-amber-fiscal">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          Au moins une source n&apos;a pas été revérifiée récemment : confirmez les montants sur
          impots.gouv.fr avant toute décision.
        </p>
      )}
    </div>
  );
}
