/**
 * Sources d'une réponse de l'agent pédagogique.
 *
 * Une réponse fiscale sans sa source n'est pas vérifiable : chaque extrait réellement utilisé est
 * affiché, avec son rang d'autorité (Légifrance, BOFiP et BOSS font foi — les guides sont
 * secondaires) et son score de similarité. Cliquer une source déplie l'extrait exact qui a servi,
 * pour que l'utilisateur puisse contrôler ce que l'agent a lu.
 */

import { useState } from "react";
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
    <div className="mt-4 pt-3 border-t border-border/70">
      {bofipLive && (
        <p className="mb-3 rounded-lg bg-teal-light/10 border border-teal-dark/25 px-3 py-2 text-[11px] text-teal-dark leading-snug">
          Repli BOFiP en direct : le corpus local était insuffisant, la réponse est ancrée sur la
          doctrine à jour.
        </p>
      )}

      {list.length > 0 && (
        <>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40 mb-2">Sources</p>
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
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] transition-colors duration-200 ${
                    autorite
                      ? "bg-teal-light/10 border-teal-dark/30 text-teal-dark"
                      : "bg-background border-border text-ink/60"
                  } ${actif ? "ring-1 ring-teal-dark/40" : "hover:border-teal-dark/50"}`}
                >
                  <span className="font-semibold">{s.source}</span>
                  {score != null && (
                    <>
                      <span className="w-8 h-1 rounded-full bg-border overflow-hidden">
                        <span
                          className="block h-full bg-teal-dark"
                          style={{ width: `${Math.round(score * 100)}%` }}
                        />
                      </span>
                      <span className="font-mono tabular-nums opacity-60">{score.toFixed(2)}</span>
                    </>
                  )}
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-70 hover:opacity-100"
                      aria-label={`Ouvrir ${s.source}`}
                    >
                      ↗
                    </a>
                  )}
                </button>
              );
            })}
          </div>

          {open != null && list[open] && (
            <div className="mt-2.5 rounded-lg bg-background border border-border p-3 animate-fade-in">
              <p className="text-[11px] font-semibold text-ink/70">
                {list[open].titre || list[open].source}
              </p>
              <p className="mt-1.5 text-[11px] text-ink/55 leading-relaxed whitespace-pre-wrap">
                {list[open].texte || list[open].extrait || "Extrait non disponible."}
              </p>
            </div>
          )}
        </>
      )}

      {fraicheur && (
        <p className="mt-2.5 text-[11px] text-amber-fiscal leading-snug">
          Au moins une source n&apos;a pas été revérifiée récemment : confirmez les montants sur
          impots.gouv.fr avant toute décision.
        </p>
      )}
    </div>
  );
}
