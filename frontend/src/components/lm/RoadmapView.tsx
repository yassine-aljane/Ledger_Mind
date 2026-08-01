/**
 * Feuille de route interactive — le rendu complet de ce que construit le moteur déterministe.
 *
 * Tout ce qui s'affiche ici vient du backend (`build_roadmap`) : parcours retenu, jauges de
 * seuils, phases, étapes, coûts, sources légales. Le composant ne décide d'aucun cas fiscal ;
 * il ne fait que rendre, et remonter deux gestes utilisateur : cocher une étape et exporter.
 *
 * L'état coché est persisté côté serveur avec la conversation : on retrouve sa progression en
 * rouvrant la feuille de route, y compris depuis un autre écran.
 *
 * Cas particulier « bascule » : tant que l'utilisateur n'a pas tranché entre micro et société
 * (`choix_fait`), on montre le comparatif au lieu des étapes — le choix se fait par les options
 * cliquables du chat, jamais par un bouton codé en dur ici.
 */

import { Check, Download, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Markdown, stripEmoji } from "@/components/lm/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Etape = {
  id: string;
  titre?: string;
  detail?: string;
  lien?: string;
  duree?: string;
  cout?: string;
  cout_source?: string;
  obligatoire?: boolean;
};

type Phase = { id: string; titre?: string; etapes: Etape[] };

export type Roadmap = {
  parcours?: string;
  choix_fait?: boolean;
  regime_recommande?: string;
  prorata?: boolean;
  bandeau?: { titre?: string; texte?: string; type?: string };
  etapes?: Etape[];
  phases?: Phase[];
  seuils_profil?: { label?: string; seuil?: number; position?: number; seuil_plein?: number }[];
  mixte?: { titre?: string; texte?: string; source?: string };
  comparatif?: { colonnes: string[]; lignes: string[][]; regle_franchissement?: string };
  legal_sources?: { label: string; valeur: string; annee: string; source: string; date_verif: string }[];
  meta?: { fraicheur?: { perime?: boolean; max_days?: number } };
};

const PHASE_ORDER: Record<string, number> = { preparer: 1, creer: 2, faire_vivre: 3 };

const euro = (n?: number | null) =>
  n == null || Number.isNaN(n)
    ? "—"
    : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)} €`;

/** Position du CA face à un plafond : passe en alerte à partir de 90 % du seuil. */
function Gauge({
  label,
  seuil,
  position,
  plein,
}: {
  label?: string;
  seuil?: number;
  position?: number;
  plein?: number;
}) {
  const ratio = seuil ? (position ?? 0) / seuil : 0;
  const warn = ratio >= 0.9;
  const width = Math.max(3, Math.min(100, ratio * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {euro(position)} / {euro(seuil)}
          {plein && plein !== seuil ? ` (plein ${euro(plein)})` : ""}
        </span>
      </div>
      <div className="h-2 rounded-full bg-background border border-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            warn ? "bg-amber-fiscal" : "bg-teal-dark"
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke="var(--teal-dark)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset .6s var(--ease-out-expo)" }}
        />
      </svg>
      <div>
        <p className="num text-xl font-medium">{pct}%</p>
        <p className="text-xs text-muted-foreground">
          {done}/{total} étapes
        </p>
      </div>
    </div>
  );
}

/** Sources légales du verdict — chiffres, textes et taux, chacun daté et sourcé.
 *
 * Repris à l'identique du style des sources de l'assistant fiscal (chip, contraste de couleur,
 * flèche), plutôt qu'une liste repliée : ce sont les textes qui justifient le régime retenu,
 * ils doivent être visibles d'emblée, pas cachés derrière un clic supplémentaire.
 */
function LegalSources({
  sources,
}: {
  sources: { label: string; valeur: string; annee: string; source: string; date_verif: string }[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="pt-1">
      <p className="rule-label mb-2 text-muted-foreground">Sources légales ({sources.length})</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => {
          const actif = open === i;
          return (
            <button
              key={i}
              onClick={() => setOpen(actif ? null : i)}
              title="Voir le détail de cette source"
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs text-success-ink transition-colors",
                actif ? "ring-1 ring-ring/50" : "hover:border-success/60",
              )}
            >
              <span className="font-medium">{s.label}</span>
              <span className="num opacity-70">{s.valeur}</span>
              <a
                href={s.source}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="opacity-70 hover:opacity-100"
                aria-label={`Ouvrir la source de ${s.label}`}
              >
                <ExternalLink className="size-3" />
              </a>
            </button>
          );
        })}
      </div>
      {open != null && sources[open] && (
        <div className="animate-fade-in mt-2.5 rounded-lg border border-border bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{sources[open].label}</span> : {sources[open].valeur}{" "}
          ({sources[open].annee}) — vérifié le {sources[open].date_verif}
        </div>
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  done,
  onToggle,
}: {
  step: Etape;
  index: number;
  done: boolean;
  onToggle?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        done
          ? "border-success/40 bg-success/8"
          : "border-border bg-card hover:border-ink/40 hover:shadow-soft",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "num grid size-8 shrink-0 place-items-center rounded-lg text-xs font-medium",
            done
              ? "bg-success text-success-foreground"
              : "border border-border bg-secondary/60 text-muted-foreground",
          )}
        >
          {done ? <Check className="size-3.5" /> : String(index).padStart(2, "0")}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-medium leading-snug">{stripEmoji(step.titre ?? "")}</p>
            <Badge variant={step.obligatoire ? "warning" : "outline"}>
              {step.obligatoire ? "Obligatoire" : "Recommandé"}
            </Badge>
          </div>

          {(step.duree || step.cout) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {step.duree && (
                <span className="num rounded-md border border-border bg-secondary/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {step.duree}
                </span>
              )}
              {step.cout && (
                <span
                  title={step.cout_source ? `Source : ${step.cout_source}` : undefined}
                  className="num rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success-ink"
                >
                  {step.cout}
                </span>
              )}
            </div>
          )}

          {(step.detail || step.lien) && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="rule-label mt-2.5 text-accent-ink transition-colors hover:text-foreground"
            >
              {open ? "Masquer le détail" : "Voir le détail"}
            </button>
          )}

          {open && (
            <div className="animate-fade-in mt-3 text-sm text-muted-foreground">
              <Markdown text={step.detail} />
              {step.lien && (
                <a
                  href={step.lien}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 break-all text-xs text-primary hover:underline"
                >
                  {step.lien} <ExternalLink className="size-3 shrink-0" />
                </a>
              )}
            </div>
          )}
        </div>

        {onToggle && (
          <input
            type="checkbox"
            checked={done}
            onChange={onToggle}
            aria-label={`Étape faite : ${step.titre ?? ""}`}
            className="mt-1 size-5 shrink-0 cursor-pointer rounded-md border-2 border-border accent-[var(--success)]"
          />
        )}
      </div>
    </div>
  );
}

export function RoadmapView({
  roadmap,
  checked = {},
  onToggle,
  onReset,
  onPdf,
}: {
  roadmap: Roadmap;
  checked?: Record<string, boolean>;
  onToggle?: (id: string) => void;
  onReset?: () => void;
  onPdf?: () => void | Promise<void>;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);

  const bandeau = roadmap.bandeau ?? {};
  const etapes = roadmap.etapes ?? [];
  const done = etapes.filter((e) => checked[e.id]).length;
  const phases = (roadmap.phases ?? [])
    .slice()
    .sort((a, b) => (PHASE_ORDER[a.id] ?? 9) - (PHASE_ORDER[b.id] ?? 9));

  // Zone de bascule non tranchée : on présente le comparatif, pas encore les étapes.
  const isBascule = roadmap.parcours === "bascule" && !roadmap.choix_fait;

  const exportPdf = async () => {
    if (!onPdf) return;
    setPdfBusy(true);
    try {
      await onPdf();
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="animate-rise space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft">
      {/* En-tête : parcours retenu, progression, position vs plafonds */}
      <div className="space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <Badge variant={bandeau.type === "bascule" ? "warning" : "default"}>
            {bandeau.titre ?? roadmap.parcours ?? "Votre parcours"}
          </Badge>
          {roadmap.prorata && (
            <Badge variant="accent">
              Seuil proratisé 1<sup>re</sup> année
            </Badge>
          )}
          {!isBascule && etapes.length > 0 && (
            <div className="ml-auto">
              <ProgressRing done={done} total={etapes.length} />
            </div>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          <Markdown text={bandeau.texte ?? roadmap.regime_recommande} />
        </div>

        {(roadmap.seuils_profil ?? []).slice(0, 3).map((s, i) => (
          <Gauge key={i} label={s.label} seuil={s.seuil} position={s.position} plein={s.seuil_plein} />
        ))}

        {roadmap.mixte && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-medium text-warning-ink">{roadmap.mixte.titre}</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">{roadmap.mixte.texte}</p>
            {roadmap.mixte.source && (
              <a
                href={roadmap.mixte.source}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Source <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}

        {roadmap.meta?.fraicheur?.perime && (
          <p className="text-xs leading-snug text-amber-fiscal">
            Seuils vérifiés il y a plus de {roadmap.meta.fraicheur.max_days} jours — une mise à jour
            officielle est peut-être disponible.
          </p>
        )}

        {(roadmap.legal_sources?.length ?? 0) > 0 && (
          <LegalSources sources={roadmap.legal_sources!} />
        )}
      </div>

      {/* Bascule micro / société : comparatif tant que le choix n'est pas fait */}
      {isBascule && roadmap.comparatif && (
        <div className="pt-2">
          <p className="text-base font-medium">Comparatif micro vs société</p>
          {roadmap.comparatif.regle_franchissement && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {roadmap.comparatif.regle_franchissement}
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {roadmap.comparatif.colonnes.map((c, i) => (
                    <th
                      key={i}
                      className="bg-primary px-3 py-2.5 text-left font-medium text-primary-foreground first:rounded-tl-xl last:rounded-tr-xl"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roadmap.comparatif.lignes.map((ligne, i) => (
                  <tr key={i} className="border-b border-border align-top">
                    {ligne.map((cell, j) => (
                      <td
                        key={j}
                        className={cn(
                          "px-3 py-2.5",
                          j === 0 ? "w-40 font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Répondez dans la conversation pour choisir votre parcours — les étapes s&apos;afficheront
            ensuite.
          </p>
        </div>
      )}

      {/* Phases et étapes du parcours retenu */}
      {!isBascule &&
        phases.map((phase) => {
          const phaseDone = phase.etapes.filter((e) => checked[e.id]).length;
          return (
            <div key={phase.id} className="pt-2">
              <div className="flex items-center gap-3 mb-3">
                <div className="num grid size-7 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  {PHASE_ORDER[phase.id] ?? "•"}
                </div>
                <p className="font-medium">{stripEmoji(phase.titre ?? "")}</p>
                <span className="num ml-auto text-xs text-muted-foreground">
                  {phaseDone}/{phase.etapes.length}
                </span>
              </div>
              <div className="border-l-2 border-border ml-3.5 pl-5 space-y-2.5">
                {phase.etapes.map((etape) => (
                  <StepCard
                    key={etape.id}
                    step={etape}
                    index={etapes.findIndex((x) => x.id === etape.id) + 1}
                    done={Boolean(checked[etape.id])}
                    onToggle={onToggle ? () => onToggle(etape.id) : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}

      {!isBascule && (onPdf || onReset) && (
        <div className="flex flex-wrap gap-3 pt-2">
          {onPdf && (
            <Button onClick={() => void exportPdf()} disabled={pdfBusy}>
              {pdfBusy ? (
                <>
                  <Loader2 className="animate-spin" /> Préparation du PDF…
                </>
              ) : (
                <>
                  <Download /> Télécharger la feuille de route (PDF)
                </>
              )}
            </Button>
          )}
          {onReset && done > 0 && (
            <Button variant="outline" onClick={onReset}>
              <RotateCcw /> Réinitialiser les coches
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Vue de progression en lecture seule — « où en suis-je dans ma feuille de route ? »
 *
 * Contrairement à `RoadmapView`, aucune étape ne se coche ici et rien ne se télécharge : cette
 * vue sert à visualiser l'avancement (déjà géré depuis la conversation ou la page résultat elle-
 * même), pas à le modifier. Les étapes s'alignent dans leur ordre, chacune portant une barre
 * verticale — verte si faite, neutre sinon — à côté de son nom.
 */
export function RoadmapStepper({
  roadmap,
  checked = {},
}: {
  roadmap: Roadmap;
  checked?: Record<string, boolean>;
}) {
  const etapes = roadmap.etapes ?? [];
  const done = etapes.filter((e) => checked[e.id]).length;
  if (etapes.length === 0) return null;

  return (
    <div className="animate-rise space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-medium">Votre progression</p>
        <p className="num text-xs text-muted-foreground">
          {done}/{etapes.length} étapes faites
        </p>
      </div>

      <div className="chat-scroll overflow-x-auto pb-1">
        <div className="flex items-stretch min-w-max px-1">
          {etapes.map((etape, i) => {
            const isDone = Boolean(checked[etape.id]);
            const isLast = i === etapes.length - 1;
            return (
              <div key={etape.id} className="flex items-stretch">
                <div className="flex items-stretch gap-2.5 w-44 shrink-0 px-2">
                  <div
                    aria-hidden
                    className={cn("w-1.5 shrink-0 rounded-full", isDone ? "bg-success" : "bg-border")}
                  />
                  <div className="min-w-0 py-0.5">
                    <p
                      className={cn(
                        "rule-label inline-flex items-center gap-1",
                        isDone ? "text-success-ink" : "text-muted-foreground",
                      )}
                    >
                      {isDone ? (
                        <>
                          <Check className="size-3" /> Fait
                        </>
                      ) : (
                        `Étape ${String(i + 1).padStart(2, "0")}`
                      )}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-sm font-medium leading-snug",
                        isDone ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {stripEmoji(etape.titre ?? "")}
                    </p>
                    {etape.obligatoire && (
                      <Badge variant="warning" className="mt-1.5">
                        Obligatoire
                      </Badge>
                    )}
                  </div>
                </div>
                {!isLast && (
                  <div
                    aria-hidden
                    className={cn("h-0.5 w-6 shrink-0 self-center", isDone ? "bg-success" : "bg-border")}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
