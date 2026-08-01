/**
 * Fiche de statut adaptative — elle se remplit TOUTE SEULE au fil de la conversation.
 *
 * Ce n'est jamais un formulaire : chaque information détectée dans la discussion apparaît en
 * carte, avec une pop-up de confirmation ; chaque carte est corrigeable (pop-up d'édition) et
 * supprimable. Ce qui manque encore pour produire la feuille de route est affiché explicitement.
 */

import { Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GuidanceProfile } from "@/lib/guidance-api";

type FieldType = "text" | "num" | "bool";

type FieldSpec = {
  key: keyof GuidanceProfile;
  label: string;
  type: FieldType;
  sub?: boolean; // carte secondaire (rattachée à la précédente)
  warn?: boolean; // point de vigilance
};

const FIELDS: FieldSpec[] = [
  { key: "activite", label: "Activité", type: "text" },
  { key: "ca_estime", label: "CA total / an", type: "num" },
  { key: "ca_prestations", label: "Prestations / an", type: "num" },
  { key: "remuneration_nature", label: "dont rémunération en nature", type: "num", sub: true },
  { key: "ca_vente", label: "Ventes / an", type: "num" },
  { key: "devise", label: "Devise", type: "text", warn: true },
  { key: "vend_produits", label: "Vend des produits", type: "bool" },
  { key: "recoit_cadeaux", label: "Reçoit des cadeaux", type: "bool" },
  { key: "situation_actuelle", label: "Situation actuelle", type: "text" },
  { key: "deja_immatricule", label: "Déjà immatriculé", type: "bool" },
];

const MISSING_LABELS: Record<string, string> = {
  activite: "Activité",
  ca_estime: "Chiffre d'affaires",
  vend_produits: "Vente de produits",
  devise: "Conversion en euros",
  ventilation: "Répartition prestations / ventes",
};

function formatValue(spec: FieldSpec, value: unknown, devise?: string | null): string {
  if (spec.type === "bool") return value ? "Oui" : "Non";
  if (spec.type === "num") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? "");
    const code = (devise || "EUR").toUpperCase();
    return n.toLocaleString("fr-FR", { style: "currency", currency: code, maximumFractionDigits: 0 });
  }
  return String(value ?? "");
}

/** Pop-up de confirmation, affichée brièvement quand une information vient d'être détectée. */
function DetectionToast({ text }: { text: string }) {
  return (
    <div className="absolute -top-3 right-0 z-20 animate-fade-in">
      <div className="whitespace-nowrap rounded-full bg-ink px-3 py-1.5 font-mono text-xs text-ink-foreground shadow-lift">
        {text}
      </div>
    </div>
  );
}

/** Pop-up d'édition d'une carte (correction manuelle par l'utilisateur). */
function EditPopover({
  spec,
  value,
  onSave,
  onClose,
}: {
  spec: FieldSpec;
  value: unknown;
  onSave: (v: string | number | boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose]);

  const commit = () => onSave(spec.type === "num" ? Number(draft) || 0 : draft.trim());

  return (
    <div
      ref={ref}
      className="animate-rise absolute left-0 top-full z-30 mt-2 w-64 rounded-2xl border border-border bg-card p-4 shadow-lift"
      role="dialog"
      aria-label={`Modifier ${spec.label}`}
    >
      <p className="rule-label mb-2 text-muted-foreground">{spec.label}</p>
      {spec.type === "bool" ? (
        <div className="flex gap-2">
          {[
            ["Oui", true],
            ["Non", false],
          ].map(([label, v]) => (
            <button
              key={String(label)}
              onClick={() => onSave(v as boolean)}
              className="flex-1 rounded-full border border-border px-3 py-2 text-xs font-medium transition-all duration-200 hover:border-ink active:scale-[0.97]"
            >
              {label as string}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            type={spec.type === "num" ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            aria-label={spec.label}
            className="input-boxed min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <Button size="sm" onClick={commit}>
            OK
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        Cette information vient de la conversation. Corrigez-la si elle est inexacte.
      </p>
    </div>
  );
}

export function StatusCard({
  profil,
  manquantes,
  onPatch,
  onClear,
  onGenerate,
  generating,
}: {
  profil: GuidanceProfile;
  manquantes: string[];
  onPatch: (field: string, value: string | number | boolean) => void;
  onClear: (field: string) => void;
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [justDetected, setJustDetected] = useState<string | null>(null);
  const previous = useRef<GuidanceProfile>({});

  // Pop-up de détection : signale la dernière information captée, puis s'efface.
  useEffect(() => {
    const nouveau = FIELDS.find(
      (f) =>
        profil[f.key] != null &&
        previous.current[f.key] == null &&
        Object.keys(previous.current).length > 0,
    );
    previous.current = { ...profil };
    if (!nouveau) return;
    setJustDetected(nouveau.label);
    const timer = setTimeout(() => setJustDetected(null), 2600);
    return () => clearTimeout(timer);
  }, [profil]);

  const known = (key: keyof GuidanceProfile) => profil[key] !== undefined && profil[key] !== null;
  const devise = String(profil.devise || "EUR").toUpperCase();

  // Cartes affichées : uniquement ce qui est connu. La devise n'apparaît que si elle n'est pas
  // l'euro (point de vigilance) ; la rémunération en nature seulement si elle est non nulle.
  const shown = FIELDS.filter((f) => {
    if (!known(f.key)) return false;
    if (f.key === "devise") return devise !== "EUR";
    if (f.key === "remuneration_nature") return Number(profil[f.key]) > 0;
    return true;
  });

  const complete = manquantes.length === 0;

  return (
    <aside className="relative h-fit rounded-2xl border border-border bg-card p-5 shadow-soft lg:sticky lg:top-24">
      {justDetected && <DetectionToast text={`${justDetected} · noté`} />}

      <p className="rule-label text-accent-ink">Ma situation</p>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
        Elle se construit toute seule au fil de la conversation.
      </p>

      {shown.length === 0 && (
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Dites-moi quelques mots sur votre activité — les informations apparaîtront ici, une à une.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {shown.map((spec) => (
          <div
            key={String(spec.key)}
            className={cn(
              "card-hover animate-rise group relative rounded-xl border px-3 py-2",
              spec.warn
                ? "border-warning/50 bg-warning/12"
                : "border-border bg-secondary/40",
              spec.sub && "ml-4 border-l-2 border-l-success",
            )}
          >
            <button
              onClick={() => onClear(String(spec.key))}
              title="Retirer cette information"
              aria-label={`Retirer ${spec.label}`}
              className="absolute right-2 top-2 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
            <p className="rule-label text-muted-foreground">{spec.label}</p>
            <button
              onClick={() => setEditing(editing === spec.key ? null : String(spec.key))}
              className="mt-0.5 text-left text-sm font-medium transition-colors hover:text-accent-ink"
              title="Cliquer pour corriger"
            >
              {formatValue(spec, profil[spec.key], profil.devise)}
            </button>

            {editing === spec.key && (
              <EditPopover
                spec={spec}
                value={profil[spec.key]}
                onSave={(v) => {
                  onPatch(String(spec.key), v);
                  setEditing(null);
                }}
                onClose={() => setEditing(null)}
              />
            )}
          </div>
        ))}
      </div>

      {!complete ? (
        <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          Encore besoin de :{" "}
          <span className="font-medium text-foreground">
            {manquantes.map((m) => MISSING_LABELS[m] ?? m).join(", ")}
          </span>
          .
        </p>
      ) : (
        onGenerate && (
          <Button
            onClick={onGenerate}
            disabled={generating}
            variant="accent"
            size="lg"
            className="mt-5 w-full"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" /> Génération…
              </>
            ) : (
              <>
                <Sparkles /> Générer ma feuille de route
              </>
            )}
          </Button>
        )
      )}
    </aside>
  );
}
