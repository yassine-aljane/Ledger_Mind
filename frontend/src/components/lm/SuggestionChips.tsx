/**
 * Chips de suggestion du profilage — cœur de la refonte « profilage rapide ».
 *
 * Pour CHAQUE information demandée, 3 réponses pré-formulées + « Autre » : un clic = réponse
 * instantanée, aucune frappe, aucun aller-retour LLM d'attente (les valeurs sont déjà connues,
 * voir `reponse_champ` côté backend). « Autre » ouvre la saisie libre — toujours disponible.
 *
 * Palette stricte marine/butter/prune/crème : jamais de texte clair sur butter (voir .suggestion-
 * chip dans styles.css). Focus clavier = même rendu que le survol.
 */

import type { SuggestionsChamp } from "@/lib/guidance-api";

export function SuggestionChips({
  structure,
  onPick,
  onAutre,
  picked,
  disabled = false,
  refining = false,
}: {
  structure: SuggestionsChamp;
  onPick: (label: string, valeurs: Record<string, unknown>) => void;
  onAutre: () => void;
  picked?: string | null;
  disabled?: boolean;
  refining?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Suggestions pour : ${structure.question}`}>
      {structure.suggestions.map((s, i) => (
        <button
          key={`${structure.champ}-${s.label}`}
          type="button"
          disabled={disabled}
          data-selected={picked === s.label}
          onClick={() => onPick(s.label, s.valeurs)}
          className="suggestion-chip chip-stagger px-4 py-2 rounded-full text-sm font-medium"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          {s.label}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        data-variant="autre"
        data-selected={picked === "__autre__"}
        onClick={onAutre}
        className="suggestion-chip chip-stagger px-4 py-2 rounded-full text-sm font-medium"
        style={{ animationDelay: `${structure.suggestions.length * 60}ms` }}
        aria-label="Répondre autrement, en texte libre ou à la voix"
      >
        Autre…
      </button>
      {refining && (
        <span className="inline-flex items-center gap-1.5 px-2 text-[11px] font-mono text-muted-foreground self-center">
          <span className="size-1.5 rounded-full bg-teal-dark animate-pulse" />
          suggestions affinées…
        </span>
      )}
    </div>
  );
}
