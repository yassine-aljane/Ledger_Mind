/**
 * Fiche de statut adaptative — elle se remplit TOUTE SEULE au fil de la conversation.
 *
 * Ce n'est jamais un formulaire : chaque information détectée dans la discussion apparaît en
 * carte, avec une pop-up de confirmation ; chaque carte est corrigeable (pop-up d'édition) et
 * supprimable. Ce qui manque encore pour produire la feuille de route est affiché explicitement.
 */

import { useEffect, useRef, useState } from "react";
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
      <div className="px-3 py-1.5 bg-ink text-background rounded-full text-[11px] font-mono shadow-lg whitespace-nowrap">
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
      className="absolute z-30 top-full left-0 mt-2 w-64 p-4 bg-white border border-border rounded-2xl shadow-xl animate-slide-up"
      role="dialog"
      aria-label={`Modifier ${spec.label}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40 mb-2">
        {spec.label}
      </p>
      {spec.type === "bool" ? (
        <div className="flex gap-2">
          {[
            ["Oui", true],
            ["Non", false],
          ].map(([label, v]) => (
            <button
              key={String(label)}
              onClick={() => onSave(v as boolean)}
              className="flex-1 px-3 py-2 border border-border rounded-full text-xs font-semibold hover:border-teal-dark hover:text-teal-dark transition-colors"
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
            className="flex-1 min-w-0 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-teal-dark"
          />
          <button
            onClick={commit}
            className="px-3 py-2 bg-ink text-background rounded-lg text-xs font-semibold hover:bg-teal-dark transition-colors"
          >
            OK
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] text-ink/40 leading-snug">
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
    <aside className="relative bg-white border border-border rounded-2xl p-5 h-fit lg:sticky lg:top-6">
      {justDetected && <DetectionToast text={`${justDetected} · noté`} />}

      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
        Ma situation
      </p>
      <p className="mt-1 text-xs text-ink/50 leading-snug">
        Elle se construit toute seule au fil de la conversation.
      </p>

      {shown.length === 0 && (
        <p className="mt-5 text-sm text-ink/40 leading-relaxed">
          Dites-moi quelques mots sur votre activité — les informations apparaîtront ici, une à une.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {shown.map((spec) => (
          <div
            key={String(spec.key)}
            className={`relative group rounded-xl border px-3 py-2 animate-slide-up ${
              spec.warn
                ? "border-amber-fiscal/50 bg-amber-fiscal/10"
                : "border-border bg-background"
            } ${spec.sub ? "ml-4 border-l-2 border-l-teal-light" : ""}`}
          >
            <button
              onClick={() => onClear(String(spec.key))}
              title="Retirer cette information"
              aria-label={`Retirer ${spec.label}`}
              className="absolute top-1.5 right-2 text-ink/25 hover:text-coral text-sm leading-none opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40">
              {spec.label}
            </p>
            <button
              onClick={() => setEditing(editing === spec.key ? null : String(spec.key))}
              className="mt-0.5 text-sm font-medium text-ink text-left hover:text-teal-dark transition-colors"
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
        <p className="mt-5 pt-4 border-t border-border text-xs text-ink/50 leading-relaxed">
          Encore besoin de :{" "}
          <span className="text-ink/80 font-medium">
            {manquantes.map((m) => MISSING_LABELS[m] ?? m).join(", ")}
          </span>
          .
        </p>
      ) : (
        onGenerate && (
          <button
            onClick={onGenerate}
            disabled={generating}
            className="mt-5 w-full px-4 py-3 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-colors disabled:opacity-50"
          >
            {generating ? "Génération…" : "Générer ma feuille de route"}
          </button>
        )
      )}
    </aside>
  );
}
