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

import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  Flag,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  PersonStanding,
  RotateCcw,
  Route as RouteIcon,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Markdown, stripEmoji } from "@/components/lm/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Etape = {
  id: string;
  phase?: string;
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

const PHASE_META: Record<
  string,
  { label: string; eyebrow: string; marker: string; surface: string }
> = {
  preparer: {
    label: "Préparer",
    eyebrow: "Clarifier le terrain",
    marker: "bg-accent text-accent-foreground",
    surface: "border-accent/35 bg-accent/10",
  },
  creer: {
    label: "Créer",
    eyebrow: "Passer à l'action",
    marker: "bg-primary text-primary-foreground",
    surface: "border-primary/25 bg-primary/8",
  },
  faire_vivre: {
    label: "Faire vivre",
    eyebrow: "Rester en règle",
    marker: "bg-success text-success-foreground",
    surface: "border-success/30 bg-success/8",
  },
};

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

function ProgressRing({ done, total, inverse = false }: { done: number; total: number; inverse?: boolean }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={inverse ? "color-mix(in oklab, var(--primary-foreground) 22%, transparent)" : "var(--border)"}
          strokeWidth="6"
        />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={inverse ? "var(--accent)" : "var(--teal-dark)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset .6s var(--ease-out-expo)" }}
        />
      </svg>
      <div>
        <p className="num text-xl font-medium">{pct}%</p>
        <p className={cn("text-xs", inverse ? "text-primary-foreground/65" : "text-muted-foreground")}>
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

type JourneyPoint = { step: Etape; index: number; x: number; y: number };

function journeyPath(points: JourneyPoint[], width: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  let path = `M 28 ${first.y} L ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const middle = (previous.x + current.x) / 2;
    path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${width - 28} ${last.y}`;
}

function StepDetail({
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
  const phase = PHASE_META[step.phase ?? "preparer"] ?? PHASE_META.preparer;
  return (
    <div className={cn("animate-fade-in rounded-2xl border p-5 sm:p-6", phase.surface)}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className={cn("num grid size-12 shrink-0 place-items-center rounded-2xl text-sm font-semibold shadow-soft", phase.marker)}>
          {done ? <Check className="size-5" /> : String(index).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rule-label text-muted-foreground">{phase.eyebrow}</span>
            <Badge variant={step.obligatoire ? "warning" : "outline"}>
              {step.obligatoire ? "Obligatoire" : "Recommandé"}
            </Badge>
          </div>
          <h3 className="mt-2 text-xl leading-tight sm:text-2xl">{stripEmoji(step.titre ?? "")}</h3>
          <div className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            <Markdown text={step.detail} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {step.duree && (
              <span className="num inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" /> {step.duree}
              </span>
            )}
            {step.cout && (
              <span
                title={step.cout_source ? `Source : ${step.cout_source}` : undefined}
                className="num rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success-ink"
              >
                {step.cout}
              </span>
            )}
            {step.lien && (
              <a
                href={step.lien}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/50"
              >
                Démarrer sur le site officiel <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
        {onToggle && (
          <Button
            variant={done ? "outline" : "default"}
            onClick={onToggle}
            className="shrink-0 rounded-full"
          >
            {done ? (
              <><CheckCircle2 /> Marquée comme faite</>
            ) : (
              <><Check /> Marquer comme faite</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Carte panoramique inspirée d'une route : le tracé donne la séquence, les jalons ouvrent
 * l'action concrète. Le canvas reste large sur mobile et se parcourt horizontalement, ce qui
 * préserve le geste visuel au lieu de compresser la route jusqu'à la rendre illisible. */
function JourneyMap({
  etapes,
  checked,
  onToggle,
  onExpand,
  showDetail = true,
}: {
  etapes: Etape[];
  checked: Record<string, boolean>;
  onToggle?: (id: string) => void;
  onExpand?: () => void;
  showDetail?: boolean;
}) {
  const next = etapes.find((step) => !checked[step.id]) ?? etapes[etapes.length - 1];
  const [selectedId, setSelectedId] = useState<string | undefined>(next?.id);
  const selected = etapes.find((step) => step.id === selectedId) ?? next;
  const selectedIndex = Math.max(0, etapes.findIndex((step) => step.id === selected?.id));
  const done = etapes.filter((step) => checked[step.id]).length;
  const progress = etapes.length ? Math.round((done / etapes.length) * 100) : 0;
  const width = Math.max(860, 250 + Math.max(0, etapes.length - 1) * 245);
  const points = useMemo<JourneyPoint[]>(
    () =>
      etapes.map((step, index) => ({
        step,
        index,
        x: 125 + index * 245,
        y: [315, 165, 300, 145][index % 4],
      })),
    [etapes],
  );
  const path = journeyPath(points, width);
  const travelerPoint =
    done === 0
      ? { x: 74, y: 315 }
      : points[Math.min(done, points.length) - 1] ?? points[0];

  if (etapes.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="relative">
        {onExpand && (
          <Button
            type="button"
            size="sm"
            onClick={onExpand}
            className="absolute right-3 top-3 z-50 border border-primary-foreground/20 bg-primary text-primary-foreground shadow-lift hover:bg-primary/90"
          >
            <Maximize2 /> Ouvrir en plein écran
          </Button>
        )}
        <div
          className={cn(
            "chat-scroll overflow-x-auto rounded-3xl border border-border bg-secondary/35 shadow-inner",
            onExpand && "cursor-zoom-in ring-2 ring-accent/20 transition hover:border-accent/60 hover:ring-accent/35",
          )}
          onClick={(event) => {
            if (onExpand && !(event.target as HTMLElement).closest("button")) onExpand();
          }}
        >
        <div className="relative h-[500px]" style={{ width }}>
          <div aria-hidden className="absolute left-10 top-8 size-32 rounded-full border-[22px] border-info/15" />
          <div aria-hidden className="absolute bottom-8 right-20 size-40 rounded-full border-[30px] border-accent/15" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage: "radial-gradient(circle, var(--primary) 1.2px, transparent 1.2px)",
              backgroundSize: "15px 15px",
              maskImage: "linear-gradient(90deg, black, transparent 35%, transparent 65%, black)",
            }}
          />

          <svg
            aria-hidden
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${width} 500`}
            preserveAspectRatio="none"
          >
            <path d={path} fill="none" stroke="var(--ink)" strokeOpacity="0.16" strokeWidth="72" strokeLinecap="round" />
            <path d={path} fill="none" stroke="var(--primary)" strokeWidth="58" strokeLinecap="round" />
            <path
              d={path}
              fill="none"
              pathLength="100"
              stroke="var(--success)"
              strokeWidth="58"
              strokeLinecap="round"
              strokeDasharray={`${progress} ${100 - progress}`}
              className="transition-all duration-700"
            />
            <path
              d={path}
              fill="none"
              stroke="var(--primary-foreground)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="18 18"
              opacity="0.9"
            />
          </svg>

          <div className="absolute left-7 top-[292px] grid size-12 place-items-center rounded-full border-4 border-background bg-accent text-accent-foreground shadow-lift">
            <Compass className="size-5" />
          </div>
          <div
            className="absolute grid size-12 place-items-center rounded-full border-4 border-background bg-success text-success-foreground shadow-lift"
            style={{ left: width - 55, top: points[points.length - 1].y - 24 }}
          >
            <Flag className="size-5" />
          </div>

          <div
            aria-live="polite"
            aria-label={`Voyageur à l'étape ${done} sur ${etapes.length}`}
            className="pointer-events-none absolute z-40 flex -translate-x-1/2 -translate-y-full flex-col items-center transition-[left,top] duration-1000 ease-in-out"
            style={{ left: travelerPoint.x, top: travelerPoint.y - 30 }}
          >
            <span className="mb-1 rounded-full border border-primary/15 bg-card/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary shadow-soft backdrop-blur">
              {done}/{etapes.length}
            </span>
            <span className="grid size-11 place-items-center rounded-full border-4 border-background bg-accent text-accent-foreground shadow-lift motion-safe:animate-bounce">
              <PersonStanding className="size-6 -rotate-12" strokeWidth={2.4} />
            </span>
            <span className="h-5 w-0.5 bg-accent" />
          </div>

          <ol className="absolute inset-0">
            {points.map(({ step, index, x, y }) => {
              const isDone = Boolean(checked[step.id]);
              const isSelected = selected?.id === step.id;
              const aboveRoad = y > 240;
              const phase = PHASE_META[step.phase ?? "preparer"] ?? PHASE_META.preparer;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(step.id)}
                    aria-current={isSelected ? "step" : undefined}
                    aria-label={`Étape ${index + 1} : ${stripEmoji(step.titre ?? "")}`}
                    className={cn(
                      "absolute z-20 grid size-14 place-items-center rounded-full border-4 border-background font-mono text-sm font-semibold shadow-lift transition-all duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
                      isDone ? "bg-success text-success-foreground" : phase.marker,
                      isSelected && "scale-110 ring-4 ring-accent/35",
                    )}
                    style={{ left: x - 28, top: y - 28 }}
                  >
                    {isDone ? <Check className="size-5" /> : String(index + 1).padStart(2, "0")}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedId(step.id)}
                    className={cn(
                      "absolute z-10 w-[210px] rounded-2xl border bg-card/95 p-3.5 text-left shadow-soft backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:border-primary/40",
                      isSelected ? "border-accent shadow-lift" : "border-border",
                    )}
                    style={{ left: x - 105, top: aboveRoad ? y - 150 : y + 50 }}
                  >
                    <span className="rule-label text-muted-foreground">
                      {PHASE_META[step.phase ?? "preparer"]?.label ?? "Étape"} · {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="mt-1.5 line-clamp-3 block text-sm font-semibold leading-snug">
                      {stripEmoji(step.titre ?? "")}
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent-ink">
                      Voir l'action <ArrowRight className="size-3" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        </div>
      </div>

      {showDetail && selected && (
        <StepDetail
          step={selected}
          index={selectedIndex + 1}
          done={Boolean(checked[selected.id])}
          onToggle={onToggle ? () => onToggle(selected.id) : undefined}
        />
      )}
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
  const [expanded, setExpanded] = useState(false);

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

  const nextStep = etapes.find((step) => !checked[step.id]);
  const progress = etapes.length ? Math.round((done / etapes.length) * 100) : 0;

  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  return (
    <>
      {expanded && (
        <button
          type="button"
          aria-label="Fermer la roadmap agrandie"
          className="fixed inset-0 z-[110] cursor-default bg-ink/75 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-labelledby="roadmap-title"
        className={cn(
          "animate-rise overflow-hidden rounded-[2rem] border-2 border-accent/40 bg-card shadow-lift ring-4 ring-accent/10",
          expanded &&
            "fixed inset-0 z-[120] overflow-y-auto rounded-none border-0 shadow-2xl ring-0",
        )}
      >
      <section className="relative overflow-hidden bg-primary px-6 py-7 text-primary-foreground sm:px-8 sm:py-9">
        <div aria-hidden className="absolute -right-12 -top-20 size-56 rounded-full bg-accent/25 blur-2xl" />
        <div aria-hidden className="absolute -bottom-24 left-1/3 size-52 rounded-full border-[28px] border-primary-foreground/5" />
        <div className="relative grid gap-7 pr-0 sm:pr-36 lg:grid-cols-[1fr_auto] lg:items-center lg:pr-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]">
                <RouteIcon className="size-3.5" /> Votre itinéraire fiscal
              </span>
              {roadmap.prorata && (
                <span className="rounded-full border border-accent/40 bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent">
                  Seuil proratisé · 1re année
                </span>
              )}
            </div>
            <p className="mt-5 text-sm text-primary-foreground/65">Cap recommandé</p>
            <h2 id="roadmap-title" className="mt-1 max-w-3xl text-3xl leading-tight sm:text-4xl">
              {bandeau.titre ?? roadmap.parcours ?? "Votre parcours"}
            </h2>
            <div className="mt-4 max-w-3xl text-sm leading-relaxed text-primary-foreground/80 sm:text-base">
              <Markdown text={bandeau.texte ?? roadmap.regime_recommande} />
            </div>
          </div>
          {!isBascule && etapes.length > 0 && (
            <div className="flex items-center gap-4 rounded-2xl border border-primary-foreground/15 bg-primary-foreground/8 p-4 backdrop-blur">
              <ProgressRing done={done} total={etapes.length} inverse />
              <div className="hidden min-w-36 border-l border-primary-foreground/15 pl-4 sm:block">
                <p className="text-xs text-primary-foreground/60">Progression globale</p>
                <p className="num mt-1 text-2xl font-semibold">{progress}%</p>
              </div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            "border border-accent/45 bg-accent font-semibold text-accent-foreground shadow-lift hover:bg-accent/90",
            expanded
              ? "fixed right-4 top-4 z-[140] sm:right-6 sm:top-6"
              : "relative mt-6 w-full sm:absolute sm:right-8 sm:top-8 sm:mt-0 sm:w-auto",
          )}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
          {expanded ? "Réduire" : "Voir la roadmap en grand"}
        </Button>
      </section>

      <div className="space-y-7 p-5 sm:p-7">
        {!isBascule && nextStep && (
          <section className="flex flex-col gap-4 rounded-2xl border border-accent/35 bg-accent/10 p-5 sm:flex-row sm:items-center">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-soft">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="rule-label text-accent-ink">Votre prochaine action</p>
              <p className="mt-1 font-semibold leading-snug">{stripEmoji(nextStep.titre ?? "")}</p>
            </div>
            {nextStep.duree && (
              <span className="num inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" /> {nextStep.duree}
              </span>
            )}
          </section>
        )}

        {!isBascule && etapes.length > 0 && (
          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="rule-label text-muted-foreground">La route, étape par étape</p>
                <h3 className="mt-1 text-2xl">Du diagnostic à une activité bien cadrée.</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {phases.map((phase) => {
                  const meta = PHASE_META[phase.id] ?? PHASE_META.preparer;
                  const phaseDone = phase.etapes.filter((step) => checked[step.id]).length;
                  return (
                    <span key={phase.id} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs", meta.surface)}>
                      <span className={cn("size-2 rounded-full", meta.marker)} />
                      {stripEmoji(phase.titre ?? meta.label)} · {phaseDone}/{phase.etapes.length}
                    </span>
                  );
                })}
              </div>
            </div>
            <JourneyMap
              etapes={etapes}
              checked={checked}
              onToggle={onToggle}
              onExpand={expanded ? undefined : () => setExpanded(true)}
            />
          </section>
        )}

        {isBascule && roadmap.comparatif && (
          <section className="rounded-2xl border border-warning/35 bg-warning/8 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning text-warning-foreground">
                <Compass className="size-5" />
              </div>
              <div>
                <p className="rule-label text-warning-ink">Carrefour de décision</p>
                <h3 className="mt-1 text-xl">Micro-entreprise ou société ?</h3>
                {roadmap.comparatif.regle_franchissement && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{roadmap.comparatif.regle_franchissement}</p>
                )}
              </div>
            </div>
            <div className="mt-5 overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead><tr>{roadmap.comparatif.colonnes.map((column, index) => <th key={index} className="bg-primary px-4 py-3 text-left font-medium text-primary-foreground">{column}</th>)}</tr></thead>
                <tbody>
                  {roadmap.comparatif.lignes.map((row, index) => (
                    <tr key={index} className="border-b border-border align-top last:border-0">
                      {row.map((cell, cellIndex) => <td key={cellIndex} className={cn("px-4 py-3", cellIndex === 0 ? "font-medium" : "text-muted-foreground")}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Répondez dans la conversation pour choisir votre voie : votre itinéraire détaillé apparaîtra aussitôt.</p>
          </section>
        )}

        {(roadmap.seuils_profil?.length ?? 0) > 0 && (
          <section className="rounded-2xl border border-border bg-secondary/35 p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><MapPin className="size-4" /></div>
              <div><p className="rule-label text-muted-foreground">Vos repères</p><h3 className="mt-0.5 text-lg">Où vous vous situez aujourd’hui</h3></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {(roadmap.seuils_profil ?? []).slice(0, 3).map((threshold, index) => (
                <Gauge key={index} label={threshold.label} seuil={threshold.seuil} position={threshold.position} plein={threshold.seuil_plein} />
              ))}
            </div>
          </section>
        )}

        {roadmap.mixte && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5 text-sm">
            <p className="font-medium text-warning-ink">{roadmap.mixte.titre}</p>
            <p className="mt-1.5 leading-relaxed text-muted-foreground">{roadmap.mixte.texte}</p>
            {roadmap.mixte.source && <a href={roadmap.mixte.source} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">Vérifier la source <ExternalLink className="size-3" /></a>}
          </div>
        )}

        {roadmap.meta?.fraicheur?.perime && <p className="text-xs leading-snug text-amber-fiscal">Seuils vérifiés il y a plus de {roadmap.meta.fraicheur.max_days} jours — une mise à jour officielle est peut-être disponible.</p>}
        {(roadmap.legal_sources?.length ?? 0) > 0 && <LegalSources sources={roadmap.legal_sources!} />}

        {!isBascule && (onPdf || onReset) && (
          <div className="flex flex-wrap gap-3 border-t border-border pt-6">
            {onPdf && <Button onClick={() => void exportPdf()} disabled={pdfBusy}>{pdfBusy ? <><Loader2 className="animate-spin" /> Préparation du PDF…</> : <><Download /> Télécharger la feuille de route</>}</Button>}
            {onReset && done > 0 && <Button variant="outline" onClick={onReset}><RotateCcw /> Réinitialiser la progression</Button>}
          </div>
        )}
      </div>
      </div>
    </>
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
    <div className="animate-rise space-y-5 rounded-[2rem] border border-border bg-card p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="rule-label text-muted-foreground">Votre parcours en un coup d’œil</p>
          <p className="mt-1 text-xl">{done === etapes.length ? "Cap atteint." : "Continuez vers la prochaine étape."}</p>
        </div>
        <div className="flex items-center gap-3">
          <ProgressRing done={done} total={etapes.length} />
        </div>
      </div>
      <JourneyMap etapes={etapes} checked={checked} />
    </div>
  );
}
