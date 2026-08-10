/**
 * Dataviz des scénarios « et si… ».
 *
 * Mêmes règles que `charts.tsx`, dont ce fichier est le prolongement :
 *  - traits de 2 px, marqueurs ≥ 8 px, extrémité arrondie 4 px côté donnée ;
 *  - 2 px de fond entre deux aplats qui se touchent ;
 *  - grille en filet 1 px, en retrait ; jamais de pointillés, sauf la ligne de PLAFOND,
 *    qui n'est pas une donnée mesurée mais un repère réglementaire — la distinguer du
 *    tracé des séries est le seul usage légitime du tiret ici ;
 *  - le texte porte des jetons de TEXTE, jamais la couleur d'une série ;
 *  - légende toujours présente dès deux séries, plus une étiquette directe sur l'extrême ;
 *  - survol ET focus clavier donnent la même infobulle, et toute valeur reste atteignable
 *    sans survol par la vue tableau.
 *
 * Les quatre pas catégoriels (`--dv-serie-1..4`) sont validés en TOUTES PAIRES — voir le
 * commentaire de `styles.css`. Ils s'assignent dans un ordre FIXE, jamais cyclé : au-delà
 * de quatre scénarios, l'écran refuse d'en ajouter plutôt que de réutiliser une teinte.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCompact, formatEuros, formatPct } from "@/lib/finance";
import { Legende } from "@/components/lm/charts";
import { COULEUR_PART, couleurSerie, MAX_SERIES } from "@/lib/scenarios-series";
import type {
  DecompositionScenario,
  PartDecomposition,
  Projection,
} from "@/lib/scenarios";

// --------------------------------------------------------------------------- Mesure

function useLargeur<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setLargeur(entry.contentRect.width));
    obs.observe(el);
    setLargeur(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  return { ref, largeur };
}

function graduations(max: number, cible = 4): { bornes: number[]; haut: number } {
  if (max <= 0) return { bornes: [0], haut: 1 };
  const brut = max / cible;
  const magnitude = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= brut) ?? magnitude * 10;
  const haut = Math.ceil(max / pas) * pas;
  const bornes: number[] = [];
  for (let v = 0; v <= haut + 1e-9; v += pas) bornes.push(v);
  return { bornes, haut };
}

function Infobulle({
  x,
  y,
  largeurHote,
  titre,
  lignes,
}: {
  x: number;
  y: number;
  largeurHote: number;
  titre: string;
  lignes: { couleur: string; label: string; valeur: string }[];
}) {
  const versGauche = x > largeurHote * 0.6;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-[11rem] rounded-xl border border-border bg-popover p-3 shadow-lift"
      style={{
        left: versGauche ? undefined : x + 12,
        right: versGauche ? largeurHote - x + 12 : undefined,
        top: Math.max(0, y - 12),
      }}
    >
      <p className="rule-label-lg mb-2 text-label-ink">{titre}</p>
      <ul className="space-y-1.5">
        {lignes.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: l.couleur }}
              />
              {l.label}
            </span>
            <span className="num text-[0.8125rem] font-medium text-foreground">{l.valeur}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------- Graphe 1 : projection sur 12 mois

const MARGE = { haut: 24, droite: 16, bas: 28, gauche: 52 };

/**
 * Cumul de chiffre d'affaires sur l'année civile, une courbe par scénario, avec la ligne
 * de plafond en repère. La question à laquelle la figure répond du regard : à quel mois un
 * scénario franchit-il le plafond du régime ?
 */
export function CourbeProjection({
  projection,
  hauteur = 280,
}: {
  projection: Projection;
  hauteur?: number;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const [tableau, setTableau] = useState(false);

  const { bornes, haut } = useMemo(
    () => graduations(projection.maximum),
    [projection.maximum],
  );

  const aireL = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const aireH = hauteur - MARGE.haut - MARGE.bas;
  const x = (mois: number) => MARGE.gauche + (aireL * mois) / 11;
  const y = (valeur: number) => MARGE.haut + aireH - (aireH * valeur) / haut;

  const series = projection.series.slice(0, MAX_SERIES);

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: hauteur }}>
        {largeur > 0 && (
          <svg
            width={largeur}
            height={hauteur}
            role="img"
            aria-label={`Projection du chiffre d'affaires cumulé sur douze mois, ${series.length} scénario(s) comparés`}
            onMouseLeave={() => setActif(null)}
          >
            {bornes.map((b) => (
              <g key={b}>
                <line
                  x1={MARGE.gauche}
                  x2={largeur - MARGE.droite}
                  y1={y(b)}
                  y2={y(b)}
                  stroke="var(--color-dv-grid)"
                  strokeWidth={1}
                />
                <text
                  x={MARGE.gauche - 8}
                  y={y(b) + 3}
                  textAnchor="end"
                  className="num fill-muted-foreground text-xs"
                >
                  {formatCompact(b)}
                </text>
              </g>
            ))}

            {/* Ligne de plafond : un repère réglementaire, pas une série. Tiret assumé —
                c'est un seuil, pas une grille — et étiquette directe pour qu'elle ne
                dépende pas de la légende.
                Elle n'apparaît QUE si elle tient dans le tracé : quand le plafond est très
                au-dessus du chiffre d'affaires, l'y forcer tassait toutes les courbes dans
                le bas du graphe. Dans ce cas il se lit sur la jauge, sous la figure. */}
            {projection.plafondVisible && projection.plafond !== null && projection.plafond <= haut && (
              <g>
                <line
                  x1={MARGE.gauche}
                  x2={largeur - MARGE.droite}
                  y1={y(projection.plafond)}
                  y2={y(projection.plafond)}
                  stroke="var(--color-destructive)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={largeur - MARGE.droite}
                  y={y(projection.plafond) - 6}
                  textAnchor="end"
                  className="fill-destructive text-xs font-medium"
                >
                  Plafond {formatCompact(projection.plafond)} €
                </text>
              </g>
            )}

            {/* Frontière réel / projeté : au-delà, la courbe est une hypothèse de tracé. */}
            {projection.dernierMoisReel < 11 && (
              <line
                x1={x(projection.dernierMoisReel)}
                x2={x(projection.dernierMoisReel)}
                y1={MARGE.haut}
                y2={MARGE.haut + aireH}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
            )}

            {series.map((serie, index) => {
              const couleur = couleurSerie(index);
              const reels = serie.points.filter((p) => p.reel);
              const projetes = serie.points.filter((p) => !p.reel);
              const chemin = (points: typeof serie.points) =>
                points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.mois)},${y(p.cumul)}`).join(" ");
              // Le segment projeté repart du dernier point réel, sans rupture visuelle.
              const dernierReel = reels[reels.length - 1];
              const cheminProjete = dernierReel
                ? `M${x(dernierReel.mois)},${y(dernierReel.cumul)} ${projetes
                    .map((p) => `L${x(p.mois)},${y(p.cumul)}`)
                    .join(" ")}`
                : chemin(projetes);
              const fin = serie.points[serie.points.length - 1];

              return (
                <g key={serie.id}>
                  {reels.length > 1 && (
                    <path d={chemin(reels)} fill="none" stroke={couleur} strokeWidth={2} />
                  )}
                  {projetes.length > 0 && (
                    <path
                      d={cheminProjete}
                      fill="none"
                      stroke={couleur}
                      strokeWidth={2}
                      strokeDasharray="2 3"
                      opacity={0.85}
                    />
                  )}
                  {/* Étiquette directe sur l'extrême : l'identité ne dépend pas de la seule
                      couleur, même quand la légende sort du champ de vision. */}
                  {fin && index < 4 && (
                    <text
                      x={x(fin.mois) - 4}
                      y={y(fin.cumul) - 8}
                      textAnchor="end"
                      className="num fill-foreground text-xs font-medium"
                    >
                      {formatCompact(fin.cumul)} €
                    </text>
                  )}
                </g>
              );
            })}

            {/* Bandes de survol : on vise un mois, pas un point de 3 px. */}
            {Array.from({ length: 12 }, (_, mois) => {
              const bande = aireL / 11;
              return (
                <g
                  key={mois}
                  tabIndex={0}
                  role="button"
                  aria-label={`${series[0]?.points[mois]?.label ?? ""} : ${series
                    .map((s) => `${s.libelle} ${formatEuros(s.points[mois]?.cumul ?? null)}`)
                    .join(", ")}`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setActif(mois)}
                  onFocus={() => setActif(mois)}
                  onBlur={() => setActif(null)}
                >
                  <rect
                    x={x(mois) - bande / 2}
                    y={MARGE.haut}
                    width={bande}
                    height={aireH}
                    fill={actif === mois ? "var(--color-secondary)" : "transparent"}
                    opacity={actif === mois ? 0.5 : 0}
                  />
                  {actif === mois &&
                    series.map((serie, index) => {
                      const point = serie.points[mois];
                      if (!point) return null;
                      return (
                        <g key={serie.id}>
                          {/* Anneau de 2 px en couleur de surface : deux marqueurs qui se
                              superposent restent distincts. */}
                          <circle
                            cx={x(mois)}
                            cy={y(point.cumul)}
                            r={5}
                            fill="var(--color-card)"
                          />
                          <circle
                            cx={x(mois)}
                            cy={y(point.cumul)}
                            r={3.5}
                            fill={couleurSerie(index)}
                          />
                        </g>
                      );
                    })}
                </g>
              );
            })}

            {series[0]?.points.map((p, i) =>
              i % 2 === 0 ? (
                <text
                  key={p.mois}
                  x={x(p.mois)}
                  y={hauteur - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-xs"
                >
                  {p.label}
                </text>
              ) : null,
            )}
          </svg>
        )}

        {actif !== null && largeur > 0 && (
          <Infobulle
            x={x(actif)}
            y={MARGE.haut + 8}
            largeurHote={largeur}
            titre={series[0]?.points[actif]?.label ?? ""}
            lignes={series.map((serie, index) => ({
              couleur: couleurSerie(index),
              label: serie.libelle,
              valeur: formatEuros(serie.points[actif]?.cumul ?? null),
            }))}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {series.length > 1 && (
          <Legende
            series={series.map((s, i) => ({ couleur: couleurSerie(i), label: s.libelle }))}
          />
        )}
        <BoutonTableau ouvert={tableau} onBasculer={() => setTableau((v) => !v)} />
      </div>

      {/* Le plafond sort du tracé quand il l'écraserait. Il reste lisible ici, sous une
          forme qui convient mieux à une valeur unique : une jauge de consommation. */}
      {!projection.plafondVisible && projection.plafond !== null && (
        <div className="mt-5 rounded-xl border border-border bg-secondary/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="rule-label-lg text-label-ink">
              Plafond du régime · {projection.plafondLibelle ?? "votre catégorie"}
            </p>
            <p className="num text-[0.8125rem] text-muted-foreground">
              {formatEuros(projection.plafond)}
            </p>
          </div>
          <ul className="mt-3 space-y-2.5">
            {series.map((serie, index) => (
              <li key={serie.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 text-[0.8125rem]">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: couleurSerie(index) }}
                    />
                    <span className="truncate text-muted-foreground">{serie.libelle}</span>
                  </p>
                  <p className="num shrink-0 text-[0.8125rem] font-medium">
                    {serie.pctPlafond === null ? "—" : formatPct(serie.pctPlafond)}
                  </p>
                </div>
                <div
                  className="mt-1.5 h-2 w-full overflow-hidden rounded-full"
                  style={{ background: "var(--color-dv-track)" }}
                  role="meter"
                  aria-valuenow={Math.round(serie.pctPlafond ?? 0)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${serie.libelle} : part du plafond consommée en fin d'année`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, serie.pctPlafond ?? 0))}%`,
                      background: couleurSerie(index),
                      transition: "width 0.8s var(--ease-out-expo)",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            Le plafond est trop éloigné de vos montants pour figurer sur la courbe sans
            l'aplatir : il se lit ici, en part consommée en fin d'année.
          </p>
        </div>
      )}

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
        Les mois écoulés portent le chiffre d'affaires réellement facturé. Au-delà du trait
        vertical, le tracé prolonge votre rythme moyen et y répartit le contrat simulé — c'est
        une mise en forme, pas une prévision d'encaissement.
      </p>

      {tableau && <TableauProjection projection={projection} />}
    </div>
  );
}

function TableauProjection({ projection }: { projection: Projection }) {
  const series = projection.series.slice(0, MAX_SERIES);
  const mois = series[0]?.points ?? [];

  return (
    <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-border">
      <table className="w-full text-left text-[0.8125rem]">
        <caption className="sr-only">
          Chiffre d&apos;affaires cumulé par mois et par scénario
        </caption>
        <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Mois</th>
            {series.map((s) => (
              <th key={s.id} scope="col" className="px-3 py-2 text-right font-medium">
                {s.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {mois.map((point, i) => (
            <tr key={point.mois}>
              <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                {point.label} {point.reel ? "" : "(projeté)"}
              </th>
              {series.map((s) => (
                <td key={s.id} className="num px-3 py-2 text-right">
                  {formatEuros(s.points[i]?.cumul ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoutonTableau({ ouvert, onBasculer }: { ouvert: boolean; onBasculer: () => void }) {
  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-expanded={ouvert}
      className="text-[0.8125rem] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {ouvert ? "Masquer le tableau" : "Voir les valeurs en tableau"}
    </button>
  );
}

// ------------------------------------------- Graphe 2 : décomposition du chiffre d'affaires

const ECART = 2; // px de fond entre deux segments qui se touchent

/**
 * Ce que devient chaque euro facturé, scénario par scénario : barres empilées horizontales,
 * comparables entre elles parce qu'elles partagent la même échelle.
 *
 * Une décomposition incomplète (IR non calculable) n'est PAS empilée : on le dit, plutôt que
 * de dessiner un « net » qui ignorerait l'impôt.
 */
export function BarresDecomposition({
  decompositions,
}: {
  decompositions: DecompositionScenario[];
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<string | null>(null);
  const [tableau, setTableau] = useState(false);

  const maximum = Math.max(1, ...decompositions.map((d) => d.caTotal));
  const hauteurBarre = 24;
  const espacement = 44;
  const hauteur = decompositions.length * espacement + 16;
  const labelL = 132;
  const aireL = Math.max(0, largeur - labelL - 16);

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: hauteur }}>
        {largeur > 0 && (
          <svg
            width={largeur}
            height={hauteur}
            role="img"
            aria-label="Répartition du chiffre d'affaires entre cotisations, impôt, formation professionnelle et net estimé"
            onMouseLeave={() => setActif(null)}
          >
            {decompositions.map((decomposition, index) => {
              const y = index * espacement + 8;
              let curseur = labelL;

              return (
                <g
                  key={decomposition.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${decomposition.libelle} : ${decomposition.parts
                    .map((p) => `${p.label} ${formatEuros(p.montant)}`)
                    .join(", ")}`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setActif(decomposition.id)}
                  onFocus={() => setActif(decomposition.id)}
                  onBlur={() => setActif(null)}
                >
                  <text
                    x={0}
                    y={y + hauteurBarre / 2 + 4}
                    className="fill-foreground text-xs"
                  >
                    {decomposition.libelle.length > 20
                      ? `${decomposition.libelle.slice(0, 19)}…`
                      : decomposition.libelle}
                  </text>

                  {decomposition.complete ? (
                    decomposition.parts.map((part) => {
                      const l = (aireL * part.montant) / maximum;
                      if (l <= 0) return null;
                      const x = curseur;
                      curseur += l + ECART;
                      return (
                        <rect
                          key={part.cle}
                          x={x}
                          y={y}
                          width={Math.max(0, l - ECART)}
                          height={hauteurBarre}
                          rx={2}
                          fill={COULEUR_PART[part.cle]}
                          opacity={actif === null || actif === decomposition.id ? 1 : 0.55}
                          style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                        />
                      );
                    })
                  ) : (
                    <>
                      <rect
                        x={labelL}
                        y={y}
                        width={aireL}
                        height={hauteurBarre}
                        rx={2}
                        fill="var(--color-dv-track)"
                      />
                      <text
                        x={labelL + 10}
                        y={y + hauteurBarre / 2 + 4}
                        className="fill-muted-foreground text-xs"
                      >
                        Impôt non calculable — complétez votre foyer fiscal
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {actif !== null && largeur > 0 && (
          <Infobulle
            x={largeur * 0.5}
            y={8}
            largeurHote={largeur}
            titre={decompositions.find((d) => d.id === actif)?.libelle ?? ""}
            lignes={(decompositions.find((d) => d.id === actif)?.parts ?? []).map((p) => ({
              couleur: COULEUR_PART[p.cle],
              label: p.label,
              valeur: formatEuros(p.montant),
            }))}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Legende
          series={[
            { couleur: COULEUR_PART.cotisations, label: "Cotisations sociales" },
            { couleur: COULEUR_PART.ir, label: "Impôt sur le revenu" },
            { couleur: COULEUR_PART.cfp, label: "Formation pro." },
            { couleur: COULEUR_PART.net, label: "Net estimé" },
          ]}
        />
        <BoutonTableau ouvert={tableau} onBasculer={() => setTableau((v) => !v)} />
      </div>

      {tableau && <TableauDecomposition decompositions={decompositions} />}
    </div>
  );
}

function TableauDecomposition({
  decompositions,
}: {
  decompositions: DecompositionScenario[];
}) {
  return (
    <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-border">
      <table className="w-full text-left text-[0.8125rem]">
        <caption className="sr-only">Répartition du chiffre d&apos;affaires par scénario</caption>
        <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Scénario</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">CA</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Cotisations</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Impôt</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Formation</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {decompositions.map((d) => {
            const part = (cle: PartDecomposition["cle"]) =>
              d.parts.find((p) => p.cle === cle)?.montant ?? null;
            return (
              <tr key={d.id}>
                <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                  {d.libelle}
                </th>
                <td className="num px-3 py-2 text-right">{formatEuros(d.caTotal)}</td>
                <td className="num px-3 py-2 text-right">{formatEuros(part("cotisations"))}</td>
                <td className="num px-3 py-2 text-right">
                  {d.complete ? formatEuros(part("ir")) : "non calculable"}
                </td>
                <td className="num px-3 py-2 text-right">{formatEuros(part("cfp"))}</td>
                <td className="num px-3 py-2 text-right font-medium">
                  {d.complete ? formatEuros(part("net")) : "non calculable"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------- Chiffre-repère : provision

/**
 * « Combien je mets de côté chaque mois ? »
 *
 * Un seul nombre par scénario : c'est une valeur unique, pas une série. Un graphe ici
 * n'ajouterait rien qu'un chiffre lisible ne dise déjà mieux — d'où une tuile, pas une figure.
 */
export function TuileProvision({
  libelle,
  parMois,
  tauxEffectif,
  index,
  accent = false,
}: {
  libelle: string;
  parMois: number | null;
  tauxEffectif: number | null;
  index: number;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-soft",
        accent ? "border-ink" : "border-border",
      )}
    >
      <p className="rule-label-lg flex items-center gap-2 text-label-ink">
        <span
          aria-hidden
          className="inline-block size-2.5 shrink-0 rounded-[3px]"
          style={{ background: couleurSerie(index) }}
        />
        <span className="truncate">{libelle}</span>
      </p>
      {parMois === null ? (
        <>
          <p className="num mt-2 text-2xl text-muted-foreground">—</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Non calculable sans votre foyer fiscal.
          </p>
        </>
      ) : (
        <>
          <p className="num mt-2 text-2xl">{formatEuros(parMois)}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            à provisionner chaque mois
            {tauxEffectif !== null ? ` · ${formatPct(tauxEffectif * 100)} du CA` : ""}
          </p>
        </>
      )}
    </div>
  );
}
