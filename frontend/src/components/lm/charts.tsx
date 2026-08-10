/**
 * Primitives de dataviz de « Ma situation ».
 *
 * Écrites à la main en SVG plutôt qu'avec une librairie : les cartes de l'app ont un
 * rendu très typé (hairlines, mono tabulaire, lavis discrets) qu'il faudrait de toute
 * façon reconstruire par-dessus les valeurs par défaut d'une librairie.
 *
 * Inventaire des formes, et ce que chacune répond :
 *  - `AiresEmpilees` — « est-ce que ça monte ? ». Vue par défaut du CA mensuel : une aire
 *    raconte une trajectoire là où douze colonnes racontent douze faits séparés.
 *  - `ColonnesMensuelles` — « combien en mars contre avril ? ». Vue alternative, gardée
 *    parce qu'une barre reste plus précise qu'une aire pour comparer deux mois nommés.
 *  - `JaugeArc` — une valeur unique face à un plafond, en 270° avec le chiffre au centre.
 *  - `Donut` — un part-à-tout à deux ou trois parts, l'angle plutôt qu'une longueur.
 *  - `Sparkline` — la micro-tendance d'une tuile d'indicateur.
 *  - `BarresClassement` — un classement, texte posé sur la barre pour lui rendre toute la
 *    largeur de la carte.
 *
 * Règles tenues par TOUS les graphes de ce fichier :
 *  - largeur de barre PROPORTIONNÉE au nombre de points (voir `largeurBarre`) : une barre
 *    plafonnée à 24 px se perd au milieu d'une série de 12 mois qui n'en compte qu'une ;
 *  - extrémité arrondie 6 px côté donnée, carrée sur la ligne de base ;
 *  - du fond entre deux aplats qui se touchent — 2 px sur les empilements, 1,2 % de la
 *    circonférence sur l'anneau ; jamais un contour dessiné autour des aplats ;
 *  - `pathLength={100}` sur tout arc ou anneau : le remplissage s'exprime directement en
 *    pourcentage, aucune longueur de courbe n'est mesurée à la main ;
 *  - grille en filet 1 px continu, en retrait ; jamais de pointillés — sauf la piste d'un
 *    arc INDÉTERMINÉ, où le pointillé est précisément le signe qu'il n'y a rien à mesurer ;
 *  - aucun texte sous 12 px, étiquettes d'axe et graduations comprises ; les capitales
 *    espacées et les graduations portent `label-ink`, un pas plus soutenu que le gris de
 *    corps de texte — à fûts fins et lettres très espacées, le gris courant se délave ;
 *  - le texte porte des jetons de TEXTE, jamais la couleur d'une série : l'identité vient
 *    de la pastille colorée posée à côté ;
 *  - deux séries ⇒ légende toujours présente, plus une étiquette directe sur l'extrême ;
 *  - survol ET focus clavier donnent la même infobulle, et chaque valeur reste atteignable
 *    sans survol via la vue tableau.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

/**
 * Largeur de barre en fonction de la densité de la série.
 *
 * Un plafond fixe traitait mal le cas le plus fréquent d'un dossier neuf : douze mois
 * affichés, un seul facturé, donc une barre de 24 px isolée au milieu du cadre — elle se
 * lisait comme un artefact plutôt que comme la donnée principale de l'écran. Moins il y a
 * de points, plus la barre a le droit d'être large.
 */
function largeurBarre(nbPoints: number, bande: number): number {
  const plafond = nbPoints <= 2 ? 88 : nbPoints <= 4 ? 64 : nbPoints <= 6 ? 48 : 34;
  return Math.min(plafond, Math.max(6, bande - 12));
}

/**
 * Courbe lissée passant par tous les points (Catmull-Rom converti en cubiques de Bézier).
 *
 * La tension est volontairement basse (1/6) : on veut retirer les angles vifs d'un
 * polyline, pas inventer des oscillations entre deux mois — une sparkline de CA ne doit
 * jamais suggérer un mouvement que les données ne portent pas.
 *
 * Les poignées sont en plus BRIDÉES à l'intervalle de valeurs du segment. Sans cela, le cas
 * le plus courant d'un dossier neuf — onze mois à zéro puis un pic — faisait creuser la
 * courbe sous la ligne de base juste avant la montée : un CA négatif purement graphique.
 */
function cheminLisse(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const brider = (v: number, a: number, b: number) =>
    Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = brider(p1.y + (p2.y - p0.y) / 6, p1.y, p2.y);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = brider(p2.y - (p3.y - p1.y) / 6, p1.y, p2.y);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
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
      className="pointer-events-none absolute z-20 min-w-40 rounded-xl border border-border bg-popover p-3 shadow-lift"
      style={{
        left: versGauche ? undefined : ancre.x + 12,
        right: versGauche ? largeurHote - ancre.x + 12 : undefined,
        top: Math.max(0, ancre.y - 12),
      }}
    >
      <p className="rule-label-lg mb-2.5 text-label-ink">{titre}</p>
      <ul className="space-y-2">
        {lignes.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              {/* Clé de série : un trait court, pas un pavé — à cette densité un aplat
                  pèse autant que la donnée elle-même. */}
              <span
                aria-hidden
                className="inline-block h-0.5 w-3.5 rounded-full"
                style={{ background: l.couleur }}
              />
              {l.label}
            </span>
            {/* La valeur mène, le nom de série suit : ici le lecteur a déjà la série. */}
            <span className="num text-[0.8125rem] font-medium text-foreground">{l.valeur}</span>
          </li>
        ))}
      </ul>
      {total && (
        <p className="mt-2.5 flex items-center justify-between gap-5 border-t border-border pt-2.5">
          <span className="rule-label-lg text-label-ink">Total HT</span>
          <span className="num text-base font-semibold text-foreground">{total}</span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Légende & vue tableau

/**
 * `taille="lg"` : version lisible à distance de lecture d'un tableau de bord.
 * La valeur par défaut reste la densité d'origine — les scénarios empilent quatre séries
 * dans des cartes bien plus étroites et n'ont pas la place d'une légende de 14 px.
 */
export function Legende({
  series,
  taille = "sm",
}: {
  series: { couleur: string; label: string }[];
  taille?: "sm" | "lg";
}) {
  const lg = taille === "lg";
  return (
    <ul className={cn("flex flex-wrap items-center gap-y-2", lg ? "gap-x-6" : "gap-x-5")}>
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-2">
          {/* La légende reprend la forme de la marque : un pavé pour des aplats. */}
          <span
            aria-hidden
            className={cn("inline-block rounded-[3px]", lg ? "size-3" : "size-2.5")}
            style={{ background: s.couleur }}
          />
          <span
            className={cn(
              lg ? "text-sm font-medium text-foreground" : "text-xs text-muted-foreground",
            )}
          >
            {s.label}
          </span>
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
    <div className="mt-5 max-h-72 overflow-auto rounded-xl border border-border">
      {/* Table large : elle défile dans SON cadre, la page ne part jamais en scroll horizontal. */}
      <table className="w-full min-w-136 text-left text-[0.8125rem]">
        <caption className="sr-only">
          Chiffre d&apos;affaires hors taxes par mois, ventilé entre prestations et ventes
        </caption>
        <thead className="sticky top-0 bg-secondary/90 backdrop-blur">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">Mois</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Prestations</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Ventes</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total HT</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Factures</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {points.map((p) => (
            <tr key={p.cle}>
              <th scope="row" className="px-4 py-2.5 font-normal text-muted-foreground">
                {p.labelLong}
              </th>
              <td className="num px-4 py-2.5 text-right">{formatEuros(p.prestations_ht)}</td>
              <td className="num px-4 py-2.5 text-right">{formatEuros(p.ventes_ht)}</td>
              <td className="num px-4 py-2.5 text-right font-semibold">{formatEuros(p.total_ht)}</td>
              <td className="num px-4 py-2.5 text-right text-muted-foreground">{p.nb_factures}</td>
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
  hauteur = 300,
  className,
}: {
  points: PointMensuel[];
  hauteur?: number;
  className?: string;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const [tableau, setTableau] = useState(false);
  // Les dégradés vivent dans le <defs> du SVG : leurs identifiants doivent être uniques même
  // si deux instances du graphe cohabitent dans la page.
  const idBase = useId().replace(/:/g, "");

  // Gouttières calibrées sur du texte de 12 px : 56 px à gauche laissent passer « 600 » sans
  // rogner, 40 px en bas donnent de l'air aux mois sous la ligne de base.
  const MARGE = { haut: 34, droite: 12, bas: 40, gauche: 56 };
  const GAP = 2; // le fond qui sépare — jamais un contour dessiné autour des aplats

  const max = Math.max(0, ...points.map((p) => p.total_ht));
  const { bornes, haut } = graduations(max);

  const aireL = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const aireH = hauteur - MARGE.haut - MARGE.bas;
  const bande = points.length > 0 ? aireL / points.length : 0;
  // Barre plafonnée : le reste de la bande reste de l'air, on ne remplit pas le créneau.
  const barreL = largeurBarre(points.length, bande);

  // Quand une bande descend sous ~34 px, un mois sur deux — on saute des étiquettes, on ne
  // rétrécit JAMAIS la police. On compte depuis la fin pour que le mois le plus récent,
  // celui que l'utilisateur cherche en premier, reste toujours étiqueté.
  const pasLabel = bande > 0 && bande < 34 ? 2 : 1;

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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Legende
          taille="lg"
          series={[
            { couleur: SERIE_1, label: "Prestations" },
            { couleur: SERIE_2, label: "Ventes" },
          ]}
        />
        <button
          type="button"
          onClick={() => setTableau((v) => !v)}
          aria-expanded={tableau}
          className="rule-label-lg rounded-full border border-border px-3 py-1.5 text-label-ink transition-colors hover:border-ink hover:text-foreground"
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
            {/* Dégradé vertical léger : la barre garde sa teinte de série en tête et s'allège
                vers la ligne de base. 15 % d'écart maximum — au-delà, deux barres de même
                hauteur ne se comparent plus. */}
            <defs>
              <linearGradient id={`${idBase}-s1`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIE_1} stopOpacity={1} />
                <stop offset="100%" stopColor={SERIE_1} stopOpacity={0.85} />
              </linearGradient>
              <linearGradient id={`${idBase}-s2`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIE_2} stopOpacity={1} />
                <stop offset="100%" stopColor={SERIE_2} stopOpacity={0.85} />
              </linearGradient>
            </defs>

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
                  x={MARGE.gauche - 12}
                  y={y(b)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="num fill-label-ink"
                  style={{ fontSize: 12 }}
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
                    rx={8}
                    fill={survole ? "var(--color-secondary)" : "transparent"}
                    opacity={survole ? 0.6 : 0}
                  />
                  {hPresta > 0 && (
                    <path
                      d={
                        hVentesNet > 0
                          ? `M${xBarre},${basePresta} L${xBarre},${yPresta} L${xBarre + barreL},${yPresta} L${
                              xBarre + barreL
                            },${basePresta} Z`
                          : cheminBarreVerticale(xBarre, yPresta, barreL, hPresta, 6)
                      }
                      fill={`url(#${idBase}-s1)`}
                      opacity={actif == null || survole ? 1 : 0.55}
                      style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                    />
                  )}
                  {hVentesNet > 0 && (
                    <path
                      d={cheminBarreVerticale(xBarre, yVentes, barreL, hVentesNet, 6)}
                      fill={`url(#${idBase}-s2)`}
                      opacity={actif == null || survole ? 1 : 0.55}
                      style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                    />
                  )}
                  {i === indexMax && p.total_ht > 0 && (
                    <text
                      x={xBarre + barreL / 2}
                      y={Math.min(yVentes, yPresta) - 10}
                      textAnchor="middle"
                      className="num fill-foreground"
                      style={{ fontSize: 13, fontWeight: 600 }}
                    >
                      {formatCompact(p.total_ht)}
                    </text>
                  )}
                  <text
                    x={xBande + bande / 2}
                    y={hauteur - 12}
                    textAnchor="middle"
                    className="fill-label-ink"
                    style={{ fontSize: 12, fontWeight: survole ? 600 : 400 }}
                  >
                    {(points.length - 1 - i) % pasLabel === 0 ? p.label : ""}
                  </text>
                </g>
              );
            })}

            {/* Ligne de base : le seul filet de la figure qui doit se voir sans effort — c'est
                lui qui dit d'où les barres poussent. */}
            <line
              x1={MARGE.gauche}
              x2={largeur - MARGE.droite}
              y1={MARGE.haut + aireH}
              y2={MARGE.haut + aireH}
              stroke="var(--color-label-ink)"
              strokeOpacity={0.35}
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

// ------------------------------------------------------- Aires empilées : CA par mois

/** Aire fermée entre une frontière haute et une frontière basse, les deux lissées. */
function aireEntre(haut: { x: number; y: number }[], bas: { x: number; y: number }[]): string {
  if (haut.length === 0) return "";
  const dHaut = cheminLisse(haut);
  // Le retour se fait sur la frontière basse parcourue à l'envers : `M` devient un `L` pour
  // rester dans le même sous-chemin, sinon le remplissage se casse en deux formes.
  const dBas = cheminLisse([...bas].reverse()).replace(/^M/, "L");
  return `${dHaut} ${dBas} Z`;
}

/**
 * Le graphe principal, en aires empilées.
 *
 * Douze colonnes discrètes racontaient douze faits indépendants ; une aire raconte une
 * TRAJECTOIRE, ce qui est la vraie question d'un cockpit de CA — « est-ce que ça monte ».
 * L'empilement conserve la ventilation prestations / ventes qui décide du régime, et le
 * réticule au survol rend chaque mois interrogeable sans le découper visuellement.
 *
 * Les colonnes restent disponibles via le sélecteur de la carte : pour comparer deux mois
 * précis, une barre reste plus lisible qu'une aire.
 */
export function AiresEmpilees({
  points,
  hauteur = 300,
  className,
}: {
  points: PointMensuel[];
  hauteur?: number;
  className?: string;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const [tableau, setTableau] = useState(false);
  const idBase = useId().replace(/:/g, "");

  const MARGE = { haut: 30, droite: 16, bas: 40, gauche: 56 };

  const max = Math.max(0, ...points.map((p) => p.total_ht));
  const { bornes, haut } = graduations(max);

  const aireL = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const aireH = hauteur - MARGE.haut - MARGE.bas;
  const bande = points.length > 0 ? aireL / points.length : 0;
  const pasLabel = bande > 0 && bande < 34 ? 2 : 1;

  const y = useCallback(
    (v: number) => MARGE.haut + aireH - (v / haut) * aireH,
    [aireH, haut, MARGE.haut],
  );
  // Un point tombe au CENTRE de sa bande, pas sur son bord : l'aire reste alignée avec les
  // étiquettes de mois et avec les colonnes si l'utilisateur bascule de vue.
  const x = useCallback((i: number) => MARGE.gauche + (i + 0.5) * bande, [bande, MARGE.gauche]);

  const geo = useMemo(() => {
    const base = points.map((_, i) => ({ x: x(i), y: MARGE.haut + aireH }));
    const presta = points.map((p, i) => ({ x: x(i), y: y(p.prestations_ht) }));
    const total = points.map((p, i) => ({ x: x(i), y: y(p.total_ht) }));
    return { base, presta, total };
  }, [points, x, y, aireH, MARGE.haut]);

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
  // Une seule série non nulle : l'aire du haut n'a rien à montrer, on ne la dessine pas.
  const aDesVentes = points.some((p) => p.ventes_ht > 0);

  return (
    <div className={className}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Legende
          taille="lg"
          series={[
            { couleur: SERIE_1, label: "Prestations" },
            ...(aDesVentes ? [{ couleur: SERIE_2, label: "Ventes" }] : []),
          ]}
        />
        <button
          type="button"
          onClick={() => setTableau((v) => !v)}
          aria-expanded={tableau}
          className="rule-label-lg rounded-full border border-border px-3 py-1.5 text-label-ink transition-colors hover:border-ink hover:text-foreground"
        >
          {tableau ? "Masquer les données" : "Voir les données"}
        </button>
      </div>

      <div ref={ref} className="relative w-full" style={{ height: hauteur }}>
        {largeur > 0 && points.length > 0 && (
          <svg
            width={largeur}
            height={hauteur}
            role="img"
            aria-label={`Chiffre d'affaires hors taxes par mois, de ${points[0]?.labelLong ?? ""} à ${
              points[points.length - 1]?.labelLong ?? ""
            }`}
            onMouseLeave={() => setActif(null)}
          >
            <defs>
              {/* Lavis vertical franc en tête, éteint sur la ligne de base : l'aire pèse
                  visuellement là où se trouve la donnée, pas sur toute sa hauteur. */}
              <linearGradient id={`${idBase}-a1`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIE_1} stopOpacity={0.45} />
                <stop offset="100%" stopColor={SERIE_1} stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id={`${idBase}-a2`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIE_2} stopOpacity={0.45} />
                <stop offset="100%" stopColor={SERIE_2} stopOpacity={0.04} />
              </linearGradient>
            </defs>

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
                  x={MARGE.gauche - 12}
                  y={y(b)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="num fill-label-ink"
                  style={{ fontSize: 12 }}
                >
                  {formatCompact(b)}
                </text>
              </g>
            ))}

            {/* Ventes d'abord : la série du dessous doit être peinte en dernier pour que son
                trait de crête reste net au contact de l'autre aplat. */}
            {aDesVentes && (
              <>
                <path d={aireEntre(geo.total, geo.presta)} fill={`url(#${idBase}-a2)`} />
                <path
                  d={cheminLisse(geo.total)}
                  fill="none"
                  stroke={SERIE_2}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
              </>
            )}
            <path d={aireEntre(geo.presta, geo.base)} fill={`url(#${idBase}-a1)`} />
            <path
              d={cheminLisse(geo.presta)}
              fill="none"
              stroke={SERIE_1}
              strokeWidth={2.5}
              strokeLinecap="round"
            />

            {/* Réticule : une seule verticale et un point par série — pas de bande grisée qui
                masquerait le lavis qu'on essaie justement de lire. */}
            {actif != null && (
              <g pointerEvents="none">
                <line
                  x1={x(actif)}
                  x2={x(actif)}
                  y1={MARGE.haut}
                  y2={MARGE.haut + aireH}
                  stroke="var(--color-label-ink)"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {aDesVentes && (
                  <>
                    <circle cx={x(actif)} cy={y(points[actif].total_ht)} r={6} fill="var(--color-card)" />
                    <circle cx={x(actif)} cy={y(points[actif].total_ht)} r={4} fill={SERIE_2} />
                  </>
                )}
                <circle
                  cx={x(actif)}
                  cy={y(points[actif].prestations_ht)}
                  r={6}
                  fill="var(--color-card)"
                />
                <circle cx={x(actif)} cy={y(points[actif].prestations_ht)} r={4} fill={SERIE_1} />
              </g>
            )}

            {/* Étiquette directe sur l'extrême, seulement hors survol : pendant le survol,
                l'infobulle dit déjà mieux, et deux chiffres se disputeraient la même zone. */}
            {indexMax >= 0 && points[indexMax].total_ht > 0 && actif == null && (
              <text
                x={x(indexMax)}
                y={y(points[indexMax].total_ht) - 12}
                textAnchor={indexMax === points.length - 1 ? "end" : "middle"}
                className="num fill-foreground"
                style={{ fontSize: 13, fontWeight: 600 }}
              >
                {formatCompact(points[indexMax].total_ht)}
              </text>
            )}

            {points.map((p, i) => (
              <g key={p.cle}>
                {/* Cible de survol / focus large d'une bande entière : on vise un mois. */}
                <rect
                  x={MARGE.gauche + i * bande}
                  y={MARGE.haut}
                  width={bande}
                  height={aireH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.labelLong} : ${formatEuros(p.total_ht)} hors taxes, dont ${formatEuros(
                    p.prestations_ht,
                  )} de prestations et ${formatEuros(p.ventes_ht)} de ventes`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setActif(i)}
                  onFocus={() => setActif(i)}
                  onBlur={() => setActif(null)}
                />
                <text
                  x={x(i)}
                  y={hauteur - 12}
                  textAnchor="middle"
                  className="fill-label-ink"
                  style={{ fontSize: 12, fontWeight: actif === i ? 600 : 400 }}
                  pointerEvents="none"
                >
                  {(points.length - 1 - i) % pasLabel === 0 || actif === i ? p.label : ""}
                </text>
              </g>
            ))}

            <line
              x1={MARGE.gauche}
              x2={largeur - MARGE.droite}
              y1={MARGE.haut + aireH}
              y2={MARGE.haut + aireH}
              stroke="var(--color-label-ink)"
              strokeOpacity={0.35}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          </svg>
        )}

        {pointActif && (
          <Infobulle
            ancre={{ x: x(actif!), y: y(pointActif.total_ht) }}
            largeurHote={largeur}
            titre={pointActif.labelLong}
            lignes={[
              { couleur: SERIE_1, label: "Prestations", valeur: formatEuros(pointActif.prestations_ht) },
              ...(aDesVentes
                ? [{ couleur: SERIE_2, label: "Ventes", valeur: formatEuros(pointActif.ventes_ht) }]
                : []),
            ]}
            total={formatEuros(pointActif.total_ht)}
          />
        )}
      </div>

      <VueTableau points={points} ouvert={tableau} />
    </div>
  );
}

// ------------------------------------------------------------------------- Jauge en arc

/** Seuils de bascule de sévérité — les mêmes que `niveauDepuisPct` dans `lib/finance`. */
const REPERES_SEUIL = [65, 85] as const;

/** Point d'un arc : `t` va de 0 à 1 sur un balayage de 270° ouvert vers le bas. */
function pointArc(cx: number, cy: number, r: number, t: number) {
  const deg = 135 + t * 270;
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function cheminArc(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const a = pointArc(cx, cy, r, t0);
  const b = pointArc(cx, cy, r, t1);
  const grand = (t1 - t0) * 270 > 180 ? 1 : 0;
  return `M${a.x},${a.y} A${r},${r} 0 ${grand} 1 ${b.x},${b.y}`;
}

/**
 * Consommation du plafond de régime, en arc.
 *
 * Une barre horizontale de 14 px se lisait comme un détail de carte ; un arc de 270 px de
 * diamètre avec le pourcentage au centre devient le sujet de sa section — ce qu'il est,
 * puisque c'est cette valeur qui décide d'un changement de régime.
 *
 * `pathLength={100}` : le remplissage est piloté par un tiret exprimé directement en
 * pourcentage, donc aucune longueur d'arc n'est mesurée à la main.
 */
export function JaugeArc({
  pct,
  niveau,
  className,
  indetermine = false,
  taille = 200,
  children,
}: {
  pct: number;
  niveau: "ok" | "attention" | "serieux" | "critique";
  className?: string;
  /** Plafond inconnu : piste en pointillés et pas d'arc de valeur (voir `CarteSeuil`). */
  indetermine?: boolean;
  taille?: number;
  /**
   * Contenu posé au CENTRE GÉOMÉTRIQUE de l'arc.
   *
   * Passé en enfant plutôt que superposé par l'appelant : la boîte du composant est plus
   * courte que le carré du SVG (un arc ouvert vers le bas ne descend pas jusqu'en bas), donc
   * un simple `place-items-center` extérieur posait le chiffre une quinzaine de pixels au-
   * dessus du vrai centre. Cette géométrie n'a pas à sortir d'ici.
   */
  children?: ReactNode;
}) {
  const couleur = {
    ok: "var(--color-success)",
    attention: "var(--color-warning)",
    serieux: "var(--color-amber-fiscal)",
    critique: "var(--color-destructive)",
  }[niveau];

  const EPAISSEUR = 16;
  const c = taille / 2;
  const r = c - EPAISSEUR / 2 - 2;
  // Un dépassement se lit sur le texte et la couleur : l'arc, lui, sature à 100 %.
  const remplissage = Math.min(100, Math.max(0, pct));
  const idBase = useId().replace(/:/g, "");
  // Hauteur réellement occupée : le point le plus bas de l'arc est son extrémité à 45°, pas
  // le bas du carré. Sans ce calcul, la boîte réservait 208 px pour 179 px de dessin.
  const hauteur = Math.ceil(c + r * Math.sin((45 * Math.PI) / 180) + EPAISSEUR / 2);

  return (
    <div
      className={cn("relative", className)}
      style={{ width: taille, height: hauteur }}
      role={indetermine ? "img" : "meter"}
      aria-valuenow={indetermine ? undefined : Math.round(pct)}
      aria-valuemin={indetermine ? undefined : 0}
      aria-valuemax={indetermine ? undefined : 100}
      aria-label={
        indetermine
          ? "Part du plafond consommée indisponible : plafond de régime inconnu"
          : "Part du plafond de régime consommée"
      }
    >
      <svg width={taille} height={taille} className="absolute left-0 top-0" aria-hidden>
        <defs>
          <linearGradient id={`${idBase}-arc`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={couleur} stopOpacity={0.7} />
            <stop offset="100%" stopColor={couleur} stopOpacity={1} />
          </linearGradient>
        </defs>

        <path
          d={cheminArc(c, c, r, 0, 1)}
          fill="none"
          stroke="var(--color-dv-track)"
          strokeWidth={EPAISSEUR}
          strokeLinecap="round"
          strokeDasharray={indetermine ? "2 7" : undefined}
        />

        {!indetermine && remplissage > 0 && (
          <path
            d={cheminArc(c, c, r, 0, 1)}
            fill="none"
            stroke={`url(#${idBase}-arc)`}
            strokeWidth={EPAISSEUR}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${remplissage} 100`}
            style={{ transition: "stroke-dasharray 0.9s var(--ease-out-expo)" }}
          />
        )}

        {/* Repères des bascules de sévérité — les mêmes seuils que `niveauDepuisPct`. */}
        {!indetermine &&
          REPERES_SEUIL.map((s) => {
            const a = pointArc(c, c, r - EPAISSEUR / 2, s / 100);
            const b = pointArc(c, c, r + EPAISSEUR / 2, s / 100);
            return (
              <line
                key={s}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            );
          })}
      </svg>

      {/* Après le SVG dans le DOM, donc au-dessus, sans avoir à créer un contexte
          d'empilement avec un z-index négatif qui passerait sous le fond de la carte. */}
      {children && (
        <div
          className="absolute inset-x-0 flex flex-col items-center"
          style={{ top: c, transform: "translateY(-50%)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------- Donut

/**
 * Part-à-tout en anneau.
 *
 * Remplace une barre empilée de 16 px de haut : à deux ou trois parts, l'anneau donne la
 * proportion par l'angle — beaucoup plus tôt dans la lecture qu'une longueur à comparer —
 * et libère son centre pour porter le total, qui était sinon une ligne de texte de plus.
 */
export function Donut({
  parts,
  taille = 168,
  epaisseur = 22,
  className,
}: {
  parts: { label: string; valeur: number; couleur: string }[];
  taille?: number;
  epaisseur?: number;
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.valeur), 0);
  if (total <= 0) return null;

  const c = taille / 2;
  const r = c - epaisseur / 2;
  // Écart de 1,2 % de la circonférence entre deux parts : le fond qui sépare, comme partout
  // ailleurs dans ce fichier — jamais un contour dessiné autour des aplats.
  const ECART = 1.2;
  const visibles = parts.filter((p) => p.valeur > 0);

  let curseur = 0;
  return (
    <svg width={taille} height={taille} className={className} aria-hidden>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-dv-track)" strokeWidth={epaisseur} />
      {visibles.map((p) => {
        const part = (Math.max(0, p.valeur) / total) * 100;
        // Une part unique n'a personne dont se séparer : on ne lui retire pas d'écart.
        const trait = visibles.length > 1 ? Math.max(0.5, part - ECART) : part;
        const decalage = -curseur;
        curseur += part;
        return (
          <circle
            key={p.label}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={p.couleur}
            strokeWidth={epaisseur}
            strokeLinecap="butt"
            pathLength={100}
            strokeDasharray={`${trait} 100`}
            strokeDashoffset={decalage}
            /* Départ à midi : un anneau qui commence à 3 h se lit comme décentré. */
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: "stroke-dasharray 0.8s var(--ease-out-expo)" }}
          />
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------------------ Sparkline

/**
 * Micro-tendance de la tuile d'indicateur principale.
 *
 * Tracée dans la teinte de la série et non plus en gris de retrait : sur un cockpit, cette
 * courbe est le second point d'entrée du regard après le grand chiffre, pas un ornement de
 * fond. L'aire dégradée donne la direction en un coup d'œil sans ajouter d'axe.
 *
 * Reste purement décorative au sens accessibilité — la valeur et sa variation sont déjà
 * écrites en toutes lettres au-dessus.
 */
export function Sparkline({
  valeurs,
  className,
  hauteur = 52,
  couleur = "var(--color-dv-serie-1)",
}: {
  valeurs: number[];
  className?: string;
  hauteur?: number;
  /** Teinte du tracé — chaque tuile d'indicateur porte la sienne. */
  couleur?: string;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const idBase = useId().replace(/:/g, "");
  const max = Math.max(1, ...valeurs);
  const n = valeurs.length;

  // 6 px de garde en haut et en bas : la courbe ne doit jamais toucher le bord, sinon on ne
  // sait plus si elle plafonne ou si elle est simplement rognée.
  const MARGE = 6;
  const points = valeurs.map((v, i) => ({
    x: n > 1 ? (i / (n - 1)) * Math.max(0, largeur - MARGE * 2) + MARGE : largeur / 2,
    y: hauteur - MARGE - (v / max) * (hauteur - MARGE * 2),
  }));
  const d = cheminLisse(points);
  const dernier = points[points.length - 1];
  // Aire sous la courbe : on referme le même tracé sur la ligne de base.
  const aire = d ? `${d} L${points[points.length - 1].x},${hauteur} L${points[0].x},${hauteur} Z` : "";

  return (
    <div ref={ref} className={cn("w-full", className)} style={{ height: hauteur }} aria-hidden>
      {largeur > 0 && n > 1 && (
        <svg width={largeur} height={hauteur}>
          <defs>
            <linearGradient id={`${idBase}-aire`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={couleur} stopOpacity={0.26} />
              <stop offset="100%" stopColor={couleur} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={aire} fill={`url(#${idBase}-aire)`} stroke="none" />
          <path
            d={d}
            fill="none"
            stroke={couleur}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {dernier && (
            <>
              {/* Halo de la couleur de carte : le point de tête reste lisible là où il croise
                  le tracé, sans qu'on ait à ajouter un contour dessiné. */}
              <circle cx={dernier.x} cy={dernier.y} r={5.5} fill="var(--color-card)" />
              <circle cx={dernier.x} cy={dernier.y} r={4} fill={couleur} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Classement (clients)

/**
 * Classement clients — barre en pleine largeur avec le texte POSÉ DESSUS.
 *
 * L'ancienne forme mettait le nom, la barre et le montant dans trois colonnes disjointes :
 * sur une carte étroite il ne restait qu'une centaine de pixels pour la barre, donc la
 * comparaison — le seul but de la figure — se faisait sur des traits minuscules. Ici la
 * barre occupe toute la ligne et sert de fond au nom et au montant : elle retrouve toute
 * la largeur de la carte, et la part de CA se lit comme un remplissage.
 *
 * Une seule teinte, en rampe d'opacité : les clients sont une magnitude à comparer, pas des
 * catégories à distinguer.
 */
export function BarresClassement({
  items,
  className,
}: {
  items: { label: string; valeur: number; secondaire?: string }[];
  className?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.valeur));
  const total = items.reduce((s, i) => s + Math.max(0, i.valeur), 0);

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, i) => {
        const part = (Math.max(0, item.valeur) / max) * 100;
        const partTotal = total > 0 ? (Math.max(0, item.valeur) / total) * 100 : 0;
        // Plancher à 0,45 pour que le dernier rang reste visible sur parchemin.
        const opacite = Math.max(0.45, 1 - i * 0.16);
        return (
          <li
            key={item.label}
            className="relative overflow-hidden rounded-xl border border-border/70"
            style={{ background: "var(--color-dv-track)" }}
          >
            {/* Le remplissage est un calque de fond : il ne pousse jamais le texte. */}
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-xl"
              style={{
                width: `${Math.max(part, 3)}%`,
                background: "var(--color-dv-serie-1)",
                opacity: opacite,
                transition: "width 0.8s var(--ease-out-expo)",
              }}
            />
            <div className="relative flex items-center gap-3 px-3.5 py-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-card text-[0.8125rem] font-semibold text-foreground">
                {i + 1}
              </span>
              <span className="truncate text-[0.9375rem] font-semibold text-foreground" title={item.label}>
                {item.label}
              </span>
              <span className="ml-auto flex shrink-0 items-baseline gap-2">
                <span className="num rounded-full bg-card/85 px-2 py-0.5 text-[0.8125rem] text-label-ink">
                  {Math.round(partTotal)} %
                </span>
                <span className="num text-[0.9375rem] font-semibold text-foreground">
                  {formatEuros(item.valeur)}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
