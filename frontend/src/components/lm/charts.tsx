/**
 * Primitives de dataviz de « Ma situation ».
 *
 * Écrites à la main en SVG plutôt qu'avec une librairie : les cartes de l'app ont un
 * rendu très typé (hairlines, mono tabulaire, lavis discrets) qu'il faudrait de toute
 * façon reconstruire par-dessus les valeurs par défaut d'une librairie.
 *
 * Règles tenues par TOUS les graphes de ce fichier :
 *  - barres ≤ 24 px, extrémité arrondie 4 px côté donnée, carrée sur la ligne de base ;
 *  - 2 px de fond entre deux aplats qui se touchent (segments empilés, barres voisines) ;
 *  - grille en filet 1 px continu, en retrait ; jamais de pointillés ;
 *  - le texte porte des jetons de TEXTE, jamais la couleur d'une série : l'identité vient
 *    de la pastille colorée posée à côté ;
 *  - deux séries ⇒ légende toujours présente, plus une étiquette directe sur l'extrême ;
 *  - survol ET focus clavier donnent la même infobulle, et chaque valeur reste atteignable
 *    sans survol via la vue tableau.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCompact, formatEuros, type PointMensuel } from "@/lib/finance";

// --------------------------------------------------------------------------- Mesure

/** Largeur réelle du conteneur : on dessine en pixels vrais pour que le texte reste net. */
function useLargeur<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setLargeur(entry.contentRect.width);
    });
    obs.observe(el);
    setLargeur(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  return { ref, largeur };
}

// --------------------------------------------------------------------------- Géométrie

/** Rectangle à extrémité haute arrondie, base carrée — la barre « pousse » depuis l'axe. */
function cheminBarreVerticale(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** Idem, arrondie côté droit : barres horizontales (classement clients). */
function cheminBarreHorizontale(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.min(r, w, h / 2);
  return [
    `M${x},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h - rr}`,
    `Q${x + w},${y + h} ${x + w - rr},${y + h}`,
    `L${x},${y + h}`,
    "Z",
  ].join(" ");
}

/** Échelle « jolie » : 0 → borne haute arrondie, avec des graduations rondes. */
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

// --------------------------------------------------------------------------- Infobulle

type Ancre = { x: number; y: number };

function Infobulle({
  ancre,
  largeurHote,
  titre,
  lignes,
  total,
}: {
  ancre: Ancre;
  largeurHote: number;
  titre: string;
  lignes: { couleur: string; label: string; valeur: string }[];
  total?: string;
}) {
  // On bascule l'infobulle du bon côté pour qu'elle ne sorte jamais du cadre.
  const versGauche = ancre.x > largeurHote * 0.6;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-[10rem] rounded-xl border border-border bg-popover p-3 shadow-lift"
      style={{
        left: versGauche ? undefined : ancre.x + 12,
        right: versGauche ? largeurHote - ancre.x + 12 : undefined,
        top: Math.max(0, ancre.y - 12),
      }}
    >
      <p className="rule-label mb-2 text-muted-foreground">{titre}</p>
      <ul className="space-y-1.5">
        {lignes.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* Clé de série : un trait court, pas un pavé — à cette densité un aplat
                  pèse autant que la donnée elle-même. */}
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: l.couleur }}
              />
              {l.label}
            </span>
            {/* La valeur mène, le nom de série suit : ici le lecteur a déjà la série. */}
            <span className="num text-xs font-medium text-foreground">{l.valeur}</span>
          </li>
        ))}
      </ul>
      {total && (
        <p className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-2">
          <span className="rule-label text-muted-foreground">Total HT</span>
          <span className="num text-sm font-medium text-foreground">{total}</span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Légende & vue tableau

export function Legende({ series }: { series: { couleur: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-2">
          {/* La légende reprend la forme de la marque : un pavé pour des aplats. */}
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[3px]"
            style={{ background: s.couleur }}
          />
          <span className="text-xs text-muted-foreground">{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Repli tabulaire : toute valeur du graphe reste lisible sans survol ni couleur. */
function VueTableau({
  points,
  ouvert,
}: {
  points: PointMensuel[];
  ouvert: boolean;
}) {
  if (!ouvert) return null;
  return (
    <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">
          Chiffre d&apos;affaires hors taxes par mois, ventilé entre prestations et ventes
        </caption>
        <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Mois</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Prestations</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Ventes</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Total HT</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Factures</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {points.map((p) => (
            <tr key={p.cle}>
              <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                {p.labelLong}
              </th>
              <td className="num px-3 py-2 text-right">{formatEuros(p.prestations_ht)}</td>
              <td className="num px-3 py-2 text-right">{formatEuros(p.ventes_ht)}</td>
              <td className="num px-3 py-2 text-right font-medium">{formatEuros(p.total_ht)}</td>
              <td className="num px-3 py-2 text-right text-muted-foreground">{p.nb_factures}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------- Colonnes empilées : CA par mois

const SERIE_1 = "var(--color-dv-serie-1)";
const SERIE_2 = "var(--color-dv-serie-2)";

/**
 * Le graphe principal : une colonne par mois, empilant prestations et ventes.
 *
 * Une seule figure porte donc la tendance ET la composition — plutôt que deux graphes
 * côte à côte qui obligeraient le lecteur à faire l'appariement lui-même.
 */
export function ColonnesMensuelles({
  points,
  hauteur = 260,
  className,
}: {
  points: PointMensuel[];
  hauteur?: number;
  className?: string;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const [tableau, setTableau] = useState(false);

  const MARGE = { haut: 24, droite: 8, bas: 28, gauche: 48 };
  const GAP = 2; // le fond qui sépare — jamais un contour dessiné autour des aplats

  const max = Math.max(0, ...points.map((p) => p.total_ht));
  const { bornes, haut } = graduations(max);

  const aireL = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const aireH = hauteur - MARGE.haut - MARGE.bas;
  const bande = points.length > 0 ? aireL / points.length : 0;
  // Barre plafonnée : le reste de la bande reste de l'air, on ne remplit pas le créneau.
  const barreL = Math.min(24, Math.max(4, bande - 10));

  const y = useCallback((v: number) => MARGE.haut + aireH - (v / haut) * aireH, [aireH, haut, MARGE.haut]);

  // Étiquette directe : uniquement sur l'extrême — un chiffre sur chaque colonne ne se lit plus.
  const indexMax = useMemo(() => {
    let idx = -1;
    let best = 0;
    points.forEach((p, i) => {
      if (p.total_ht > best) {
        best = p.total_ht;
        idx = i;
      }
    });
    return idx;
  }, [points]);

  const pointActif = actif != null ? points[actif] : null;

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Legende
          series={[
            { couleur: SERIE_1, label: "Prestations" },
            { couleur: SERIE_2, label: "Ventes" },
          ]}
        />
        <button
          type="button"
          onClick={() => setTableau((v) => !v)}
          aria-expanded={tableau}
          className="rule-label text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {tableau ? "Masquer les données" : "Voir les données"}
        </button>
      </div>

      <div ref={ref} className="relative w-full" style={{ height: hauteur }}>
        {largeur > 0 && (
          <svg
            width={largeur}
            height={hauteur}
            role="img"
            aria-label={`Chiffre d'affaires hors taxes par mois, de ${points[0]?.labelLong ?? ""} à ${
              points[points.length - 1]?.labelLong ?? ""
            }`}
            onMouseLeave={() => setActif(null)}
          >
            {/* Grille en filet, en retrait : elle porte les valeurs non étiquetées. */}
            {bornes.map((b) => (
              <g key={b}>
                <line
                  x1={MARGE.gauche}
                  x2={largeur - MARGE.droite}
                  y1={y(b)}
                  y2={y(b)}
                  stroke="var(--color-dv-grid)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={MARGE.gauche - 10}
                  y={y(b)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="num fill-muted-foreground"
                  style={{ fontSize: 10 }}
                >
                  {formatCompact(b)}
                </text>
              </g>
            ))}

            {points.map((p, i) => {
              const xBande = MARGE.gauche + i * bande;
              const xBarre = xBande + (bande - barreL) / 2;
              const hPresta = (p.prestations_ht / haut) * aireH;
              const hVentes = (p.ventes_ht / haut) * aireH;
              const survole = actif === i;

              // Le segment du haut porte l'arrondi ; celui du bas reste carré sur l'axe.
              const basePresta = MARGE.haut + aireH;
              const yPresta = basePresta - hPresta;
              const hVentesNet = hVentes > 0 && hPresta > 0 ? Math.max(0, hVentes - GAP) : hVentes;
              const yVentes = yPresta - GAP - hVentesNet;

              return (
                <g
                  key={p.cle}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.labelLong} : ${formatEuros(p.total_ht)} hors taxes, dont ${formatEuros(
                    p.prestations_ht,
                  )} de prestations et ${formatEuros(p.ventes_ht)} de ventes`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setActif(i)}
                  onFocus={() => setActif(i)}
                  onBlur={() => setActif(null)}
                >
                  {/* Cible de survol élargie à toute la bande : on vise un mois, pas 12 px. */}
                  <rect
                    x={xBande}
                    y={MARGE.haut}
                    width={bande}
                    height={aireH}
                    fill={survole ? "var(--color-secondary)" : "transparent"}
                    opacity={survole ? 0.5 : 0}
                  />
                  {hPresta > 0 && (
                    <path
                      d={
                        hVentesNet > 0
                          ? `M${xBarre},${basePresta} L${xBarre},${yPresta} L${xBarre + barreL},${yPresta} L${
                              xBarre + barreL
                            },${basePresta} Z`
                          : cheminBarreVerticale(xBarre, yPresta, barreL, hPresta)
                      }
                      fill={SERIE_1}
                      opacity={actif == null || survole ? 1 : 0.55}
                      style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                    />
                  )}
                  {hVentesNet > 0 && (
                    <path
                      d={cheminBarreVerticale(xBarre, yVentes, barreL, hVentesNet)}
                      fill={SERIE_2}
                      opacity={actif == null || survole ? 1 : 0.55}
                      style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                    />
                  )}
                  {i === indexMax && p.total_ht > 0 && (
                    <text
                      x={xBarre + barreL / 2}
                      y={Math.min(yVentes, yPresta) - 8}
                      textAnchor="middle"
                      className="num fill-foreground"
                      style={{ fontSize: 10, fontWeight: 500 }}
                    >
                      {formatCompact(p.total_ht)}
                    </text>
                  )}
                  <text
                    x={xBande + bande / 2}
                    y={hauteur - 8}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{ fontSize: 10 }}
                  >
                    {/* Sur 12 mois serrés, un mois sur deux suffit à situer l'axe. */}
                    {points.length > 8 && i % 2 === 1 ? "" : p.label}
                  </text>
                </g>
              );
            })}

            <line
              x1={MARGE.gauche}
              x2={largeur - MARGE.droite}
              y1={MARGE.haut + aireH}
              y2={MARGE.haut + aireH}
              stroke="var(--color-border)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          </svg>
        )}

        {pointActif && (
          <Infobulle
            ancre={{
              x: MARGE.gauche + (actif! + 0.5) * bande,
              y: y(pointActif.total_ht),
            }}
            largeurHote={largeur}
            titre={pointActif.labelLong}
            lignes={[
              { couleur: SERIE_1, label: "Prestations", valeur: formatEuros(pointActif.prestations_ht) },
              { couleur: SERIE_2, label: "Ventes", valeur: formatEuros(pointActif.ventes_ht) },
            ]}
            total={formatEuros(pointActif.total_ht)}
          />
        )}
      </div>

      <VueTableau points={points} ouvert={tableau} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Sparkline

/**
 * Micro-tendance d'une tuile d'indicateur : le contexte en retrait, la période
 * courante en accent. Purement décorative au sens accessibilité — la valeur et sa
 * variation sont déjà écrites en toutes lettres au-dessus.
 */
export function Sparkline({
  valeurs,
  className,
  hauteur = 32,
}: {
  valeurs: number[];
  className?: string;
  hauteur?: number;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const max = Math.max(1, ...valeurs);
  const n = valeurs.length;

  const points = valeurs.map((v, i) => ({
    x: n > 1 ? (i / (n - 1)) * Math.max(0, largeur - 6) + 3 : largeur / 2,
    y: hauteur - 4 - (v / max) * (hauteur - 8),
  }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const dernier = points[points.length - 1];

  return (
    <div ref={ref} className={cn("w-full", className)} style={{ height: hauteur }} aria-hidden>
      {largeur > 0 && n > 1 && (
        <svg width={largeur} height={hauteur}>
          <path
            d={d}
            fill="none"
            stroke="var(--color-dv-muted)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {dernier && (
            <>
              {/* Anneau au fond : le point de tête reste lisible là où il croise le tracé. */}
              <circle cx={dernier.x} cy={dernier.y} r={5} fill="var(--color-card)" />
              <circle cx={dernier.x} cy={dernier.y} r={3.5} fill="var(--color-dv-serie-1)" />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- Jauge

/**
 * Jauge de consommation du plafond de régime.
 *
 * La piste est un pas clair de la même rampe (et non un gris neutre) pour que l'état se
 * lise sur toute la longueur de la barre, pas seulement sur la portion remplie.
 */
export function JaugeSeuil({
  pct,
  niveau,
  className,
}: {
  pct: number;
  niveau: "ok" | "attention" | "serieux" | "critique";
  className?: string;
}) {
  const couleur = {
    ok: "var(--color-success)",
    attention: "var(--color-warning)",
    serieux: "var(--color-amber-fiscal)",
    critique: "var(--color-destructive)",
  }[niveau];

  const remplissage = Math.min(100, Math.max(0, pct));

  return (
    <div className={className}>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-dv-track)" }}
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Part du plafond de régime consommée"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${remplissage}%`,
            background: couleur,
            transition: "width 0.8s var(--ease-out-expo)",
          }}
        />
        {/* Repère des 100 % : visible même quand la barre est loin d'être pleine. */}
        {pct < 100 && (
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-px bg-foreground/25"
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Classement (clients)

/**
 * Barres horizontales pour un classement — forme séquentielle, une seule teinte :
 * les clients ne sont pas des catégories à distinguer, c'est une magnitude à comparer.
 */
export function BarresClassement({
  items,
  className,
}: {
  items: { label: string; valeur: number; secondaire?: string }[];
  className?: string;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const max = Math.max(1, ...items.map((i) => i.valeur));
  const HAUTEUR_LIGNE = 40;
  const HAUTEUR_BARRE = 10;
  const LARGEUR_LABEL = Math.min(180, Math.max(96, largeur * 0.3));

  return (
    <div ref={ref} className={cn("w-full", className)}>
      {largeur > 0 && (
        <ul className="space-y-0">
          {items.map((item, i) => {
            const dispo = Math.max(0, largeur - LARGEUR_LABEL - 88);
            const w = (item.valeur / max) * dispo;
            // Plus le rang est haut, plus la teinte est soutenue : une rampe, pas des couleurs.
            const opacite = 1 - i * 0.14;
            return (
              <li
                key={item.label}
                className="flex items-center gap-3 border-b border-border/60 last:border-0"
                style={{ height: HAUTEUR_LIGNE }}
              >
                <span
                  className="truncate text-sm text-foreground"
                  style={{ width: LARGEUR_LABEL }}
                  title={item.label}
                >
                  {item.label}
                </span>
                <svg width={Math.max(0, dispo)} height={HAUTEUR_BARRE} className="shrink-0">
                  <path
                    d={cheminBarreHorizontale(0, 0, Math.max(0, w), HAUTEUR_BARRE)}
                    fill="var(--color-dv-serie-1)"
                    opacity={opacite}
                  />
                </svg>
                <span className="num ml-auto shrink-0 text-right text-sm font-medium text-foreground">
                  {formatEuros(item.valeur)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
