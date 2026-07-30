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

import { useState } from "react";
import { Markdown, stripEmoji } from "@/components/lm/Markdown";

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
        <span className="text-ink/60">{label}</span>
        <span className="font-mono text-ink/70 tabular-nums">
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
        <p className="text-xl font-extrabold tracking-tight tabular-nums">{pct}%</p>
        <p className="text-[11px] text-ink/50">
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
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40 mb-2">
        Sources légales ({sources.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => {
          const actif = open === i;
          return (
            <button
              key={i}
              onClick={() => setOpen(actif ? null : i)}
              title="Voir le détail de cette source"
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] transition-colors ${
                "bg-teal-light/10 border-teal-dark/30 text-teal-dark"
              } ${actif ? "ring-1 ring-teal-dark/40" : "hover:border-teal-dark/50"}`}
            >
              <span className="font-semibold">{s.label}</span>
              <span className="font-mono tabular-nums opacity-70">{s.valeur}</span>
              <a
                href={s.source}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="opacity-70 hover:opacity-100"
                aria-label={`Ouvrir la source de ${s.label}`}
              >
                ↗
              </a>
            </button>
          );
        })}
      </div>
      {open != null && sources[open] && (
        <div className="mt-2.5 rounded-lg bg-background border border-border p-3 animate-fade-in text-[11px] text-ink/60 leading-relaxed">
          <span className="font-semibold text-ink/80">{sources[open].label}</span> : {sources[open].valeur}{" "}
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
      className={`rounded-xl border p-4 transition-colors ${
        done ? "border-teal-dark/40 bg-teal-light/10" : "border-border bg-white hover:border-teal-dark/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 size-8 rounded-lg grid place-items-center font-mono text-xs font-semibold ${
            done ? "bg-teal-dark text-background" : "bg-background border border-border text-ink/60"
          }`}
        >
          {done ? "✓" : String(index).padStart(2, "0")}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="font-semibold text-[15px] leading-snug">{stripEmoji(step.titre ?? "")}</p>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${
                step.obligatoire
                  ? "bg-amber-fiscal/15 text-amber-fiscal"
                  : "bg-background border border-border text-ink/45"
              }`}
            >
              {step.obligatoire ? "Obligatoire" : "Recommandé"}
            </span>
          </div>

          {(step.duree || step.cout) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {step.duree && (
                <span className="px-2 py-0.5 rounded-md bg-background border border-border text-[11px] text-ink/55">
                  {step.duree}
                </span>
              )}
              {step.cout && (
                <span
                  title={step.cout_source ? `Source : ${step.cout_source}` : undefined}
                  className="px-2 py-0.5 rounded-md bg-teal-light/10 border border-teal-dark/25 text-[11px] text-teal-dark font-medium"
                >
                  {step.cout}
                </span>
              )}
            </div>
          )}

          {(step.detail || step.lien) && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-2.5 text-[11px] font-mono uppercase tracking-wider text-teal-dark hover:text-ink transition-colors"
            >
              {open ? "Masquer le détail" : "Voir le détail"}
            </button>
          )}

          {open && (
            <div className="mt-3 text-sm text-ink/70 animate-fade-in">
              <Markdown text={step.detail} />
              {step.lien && (
                <a
                  href={step.lien}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 text-xs text-teal-dark hover:underline break-all"
                >
                  {step.lien} ↗
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
            className="shrink-0 mt-1 size-5 rounded-md border-2 border-border accent-teal-dark cursor-pointer"
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
    <div className="bg-white border border-border rounded-2xl p-6 space-y-5 animate-slide-up">
      {/* En-tête : parcours retenu, progression, position vs plafonds */}
      <div className="space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              bandeau.type === "bascule"
                ? "bg-amber-fiscal/15 text-amber-fiscal"
                : "bg-teal-dark text-background"
            }`}
          >
            {bandeau.titre ?? roadmap.parcours ?? "Votre parcours"}
          </span>
          {roadmap.prorata && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-fiscal/10 text-amber-fiscal">
              Seuil proratisé 1<sup>re</sup> année
            </span>
          )}
          {!isBascule && etapes.length > 0 && (
            <div className="ml-auto">
              <ProgressRing done={done} total={etapes.length} />
            </div>
          )}
        </div>

        <div className="text-sm text-ink/75">
          <Markdown text={bandeau.texte ?? roadmap.regime_recommande} />
        </div>

        {(roadmap.seuils_profil ?? []).slice(0, 3).map((s, i) => (
          <Gauge key={i} label={s.label} seuil={s.seuil} position={s.position} plein={s.seuil_plein} />
        ))}

        {roadmap.mixte && (
          <div className="rounded-xl border border-amber-fiscal/40 bg-amber-fiscal/8 p-4 text-sm">
            <p className="font-semibold text-amber-fiscal">{roadmap.mixte.titre}</p>
            <p className="mt-1 text-ink/70 leading-relaxed">{roadmap.mixte.texte}</p>
            {roadmap.mixte.source && (
              <a
                href={roadmap.mixte.source}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs text-teal-dark hover:underline"
              >
                Source ↗
              </a>
            )}
          </div>
        )}

        {roadmap.meta?.fraicheur?.perime && (
          <p className="text-[11px] text-amber-fiscal leading-snug">
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
          <p className="font-semibold text-ink">Comparatif micro vs société</p>
          {roadmap.comparatif.regle_franchissement && (
            <p className="mt-1 text-xs text-ink/55 leading-relaxed">
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
                      className="text-left px-3 py-2.5 bg-teal-dark text-background font-semibold first:rounded-tl-xl last:rounded-tr-xl"
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
                        className={`px-3 py-2.5 ${
                          j === 0 ? "font-semibold text-teal-dark w-40" : "text-ink/70"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink/50">
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
                <div className="size-7 rounded-full bg-teal-dark text-background grid place-items-center font-mono text-xs font-bold">
                  {PHASE_ORDER[phase.id] ?? "•"}
                </div>
                <p className="font-semibold text-teal-dark">{stripEmoji(phase.titre ?? "")}</p>
                <span className="ml-auto font-mono text-[11px] text-ink/40 tabular-nums">
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
            <button
              onClick={() => void exportPdf()}
              disabled={pdfBusy}
              className="px-5 py-2.5 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
            >
              {pdfBusy ? "Préparation du PDF…" : "Télécharger la feuille de route (PDF)"}
            </button>
          )}
          {onReset && done > 0 && (
            <button
              onClick={onReset}
              className="px-5 py-2.5 bg-white border border-border rounded-xl text-sm font-semibold hover:border-teal-dark hover:text-teal-dark transition-colors"
            >
              Réinitialiser les coches
            </button>
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
    <div className="bg-white border border-border rounded-2xl p-6 space-y-5 animate-slide-up">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-ink">Votre progression</p>
        <p className="font-mono text-xs text-ink/50 tabular-nums">
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
                    className={`w-1.5 rounded-full shrink-0 ${isDone ? "bg-teal-dark" : "bg-border"}`}
                  />
                  <div className="min-w-0 py-0.5">
                    <p
                      className={`font-mono text-[10px] tracking-wider uppercase ${
                        isDone ? "text-teal-dark" : "text-ink/40"
                      }`}
                    >
                      {isDone ? "✓ Fait" : `Étape ${String(i + 1).padStart(2, "0")}`}
                    </p>
                    <p
                      className={`mt-1 text-sm font-medium leading-snug ${
                        isDone ? "text-ink" : "text-ink/70"
                      }`}
                    >
                      {stripEmoji(etape.titre ?? "")}
                    </p>
                    {etape.obligatoire && (
                      <span className="mt-1.5 inline-block px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider bg-amber-fiscal/15 text-amber-fiscal">
                        Obligatoire
                      </span>
                    )}
                  </div>
                </div>
                {!isLast && (
                  <div
                    aria-hidden
                    className={`w-6 self-center h-0.5 shrink-0 ${isDone ? "bg-teal-dark" : "bg-border"}`}
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
