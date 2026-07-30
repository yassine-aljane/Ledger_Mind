/**
 * Icône d'aide contextuelle (ⓘ) — à côté de chaque document demandé.
 *
 * Explique à quoi sert le document, où l'obtenir, son format et sa durée de validité, pour
 * accompagner l'utilisateur plutôt que de simplement lui réclamer une pièce. Purement informatif :
 * n'affecte aucun champ, aucun état, aucune logique de vérification.
 *
 * Clic pour ouvrir/fermer (pas seulement le survol, pour rester utilisable au clavier/tactile) ;
 * ferme au clic extérieur ou sur Échap — même pattern que `StatusCard.EditPopover`.
 */

import { useEffect, useRef, useState } from "react";

export type InfoItem = { label: string; value: string };

export type InfoContent = {
  titre: string;
  items: InfoItem[];
  source?: { label: string; url: string };
};

export function InfoTooltip({ content, label }: { content: InfoContent; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={`À propos de : ${label}`}
        title={`À propos de : ${label}`}
        className="inline-flex items-center justify-center size-4 rounded-full border border-ink/30 text-ink/50 hover:border-teal-dark hover:text-teal-dark transition-colors duration-200 focus-visible:border-teal-dark focus-visible:text-teal-dark"
      >
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5.3" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6 5.4v3.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="3.5" r="0.7" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Aide : ${content.titre}`}
          className="absolute z-30 top-full left-0 mt-2 w-72 p-4 bg-white border border-border rounded-2xl shadow-xl animate-slide-up text-left"
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-teal-dark mb-3">
            {content.titre}
          </p>
          <dl className="space-y-2.5">
            {content.items.map((it) => (
              <div key={it.label}>
                <dt className="text-[10px] uppercase tracking-wider text-ink/40 font-semibold">
                  {it.label}
                </dt>
                <dd className="text-xs text-ink/75 leading-relaxed mt-0.5">{it.value}</dd>
              </div>
            ))}
          </dl>
          {content.source && (
            <a
              href={content.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-[11px] text-teal-dark hover:underline"
            >
              Source : {content.source.label} ↗
            </a>
          )}
        </div>
      )}
    </span>
  );
}
