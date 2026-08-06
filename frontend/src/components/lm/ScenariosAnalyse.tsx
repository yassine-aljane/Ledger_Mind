/**
 * Figures et blocs d'analyse des scénarios.
 *
 * Module séparé de `ScenariosCharts.tsx`, qui porte déjà les trois figures de comparaison
 * et approche des 650 lignes.
 *
 * --- DEUX DÉCISIONS DE FORME, à lire avant de toucher aux figures ---
 *
 * 1. LA CASCADE REMPLACE UNE BARRE EMPILÉE, qui échouait sur ses propres chiffres.
 *    Sur un CA de 30 000 € en BNC, le moteur donne : cotisations 7 680 €, impôt 413 €,
 *    formation 60 €, net 21 847 €. Rapportées à une barre de 700 px, ces valeurs occupent
 *    respectivement 179, 10, 1,4 et 510 px — et l'écart réglementaire de 2 px entre deux
 *    aplats faisait alors DISPARAÎTRE la formation professionnelle, tandis que l'impôt,
 *    à 7 px utiles, ne pouvait porter aucune étiquette.
 *    Une cascade donne à chaque poste sa propre ligne, de hauteur constante : la longueur
 *    porte la magnitude, la lisibilité ne dépend plus d'elle. Les valeurs sont posées à
 *    l'EXTÉRIEUR des barres, jamais dedans.
 *
 * 2. L'ABATTEMENT N'EST PAS DANS LA CASCADE. Ce n'est pas de l'argent qui part, c'est une
 *    part du chiffre d'affaires que le fisc ne regarde pas : les 34 % abattus restent
 *    intégralement sur le compte. Le mettre sur la même échelle que les cotisations
 *    donnerait à lire « 34 % de mon CA disparaît », l'inverse exact de la vérité. Il vit
 *    donc dans un chiffre-repère en toutes lettres — une valeur unique n'a pas besoin
 *    d'une figure.
 *    (La version précédente le hachurait ; la texture par défaut est un anti-pattern —
 *    elle est réservée aux réglages d'accessibilité, à l'impression et aux couleurs
 *    forcées. Elle a donc été retirée.)
 *
 * Aucune teinte nouvelle n'a été nécessaire : les quatre pas `--dv-serie-1..4` suffisent
 * et restent validés en toutes paires dans les deux modes.
 *
 * Règles communes à `charts.tsx` tenues ici : marques fines, texte en jetons de TEXTE
 * jamais en couleur de série, étiquettes directes hors des barres, survol ET focus clavier
 * donnant la même infobulle, vue tableau de repli sur chaque figure.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Info, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros, formatPct } from "@/lib/finance";
import { COULEUR_PART } from "@/lib/scenarios-series";
import type {
  ComparaisonOption,
  EtapeCalcul,
  LigneAbattement,
  MarcheCascade,
  SourceChiffres,
} from "@/lib/scenarios";

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

// ------------------------------------------------------ Figure : le parcours d'un euro

const HAUTEUR_MARCHE = 26;
const ESPACEMENT_MARCHE = 46;
const LARGEUR_LABEL = 148;
const LONGUEUR_MIN = 3; // px : un poste minuscule reste repérable sur son axe

const COULEUR_MARCHE: Record<string, string> = {
  ca: "var(--color-dv-muted)",
  cotisations: COULEUR_PART.cotisations,
  ir: COULEUR_PART.ir,
  cfp: COULEUR_PART.cfp,
  net: COULEUR_PART.net,
};

/**
 * Cascade : du chiffre d'affaires encaissé à ce qui reste, une marche par prélèvement.
 *
 * Cette figure REMPLACE une barre empilée à 100 %, qui échouait sur ses propres chiffres.
 * Sur un CA de 30 000 €, la formation professionnelle pèse 0,20 % : dans une barre de
 * 700 px elle occupait 1,4 px, soit moins que l'écart de 2 px qui la séparait de sa
 * voisine — elle était donc littéralement invisible, et l'impôt, à 7 px, ne pouvait porter
 * aucune étiquette.
 *
 * Ici chaque poste a sa propre ligne, de hauteur constante : seule la LONGUEUR porte la
 * magnitude, et le libellé comme la valeur restent lisibles quel que soit le montant. Les
 * valeurs sont posées à l'extérieur de la barre, jamais dedans — une étiquette rognée par
 * un segment trop court est le défaut que cette refonte corrige.
 */
export function CascadeFiscale({
  marches,
  complet,
}: {
  marches: MarcheCascade[];
  complet: boolean;
}) {
  const { ref, largeur } = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<string | null>(null);
  const [tableau, setTableau] = useState(false);

  const ca = marches.find((m) => m.cle === "ca")?.montant ?? 0;
  const hauteur = marches.length * ESPACEMENT_MARCHE + 8;
  const aireL = Math.max(0, largeur - LARGEUR_LABEL - 8);
  const marcheActive = marches.find((m) => m.cle === actif) ?? null;
  const x = (valeur: number) => (ca > 0 ? LARGEUR_LABEL + (aireL * valeur) / ca : LARGEUR_LABEL);

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: hauteur }}>
        {largeur > 0 && ca > 0 && (
          <svg
            width={largeur}
            height={hauteur}
            role="img"
            aria-label="Cascade du chiffre d'affaires : cotisations, impôt et formation professionnelle retirés, puis ce qui reste"
            onMouseLeave={() => setActif(null)}
          >
            {marches.map((marche, index) => {
              const y = index * ESPACEMENT_MARCHE + 4;
              const xDebut = x(marche.debut);
              const longueur = Math.max(LONGUEUR_MIN, x(marche.fin) - xDebut);
              const survole = actif === marche.cle;
              const total = marche.type !== "retrait";

              return (
                <g
                  key={marche.cle}
                  tabIndex={0}
                  role="button"
                  aria-label={`${marche.label} : ${formatEuros(marche.montant)}, soit ${formatPct(
                    marche.part * 100,
                  )} du chiffre d'affaires. ${marche.explication}`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setActif(marche.cle)}
                  onFocus={() => setActif(marche.cle)}
                  onBlur={() => setActif(null)}
                >
                  {/* Cible de survol pleine largeur : on vise une ligne, pas 3 px de barre. */}
                  <rect
                    x={0}
                    y={y - 8}
                    width={largeur}
                    height={ESPACEMENT_MARCHE - 4}
                    fill={survole ? "var(--color-secondary)" : "transparent"}
                    opacity={survole ? 0.5 : 0}
                    rx={8}
                  />

                  <text
                    x={0}
                    y={y + HAUTEUR_MARCHE / 2 + 4}
                    className={cn(
                      "text-[11px]",
                      total ? "fill-foreground font-medium" : "fill-muted-foreground",
                    )}
                  >
                    {marche.type === "retrait" ? `− ${marche.label}` : marche.label}
                  </text>

                  <rect
                    x={xDebut}
                    y={y}
                    width={longueur}
                    height={HAUTEUR_MARCHE}
                    rx={2}
                    fill={COULEUR_MARCHE[marche.cle] ?? COULEUR_PART.net}
                    opacity={actif === null || survole ? 1 : 0.55}
                    style={{ transition: "opacity 0.15s var(--ease-out-expo)" }}
                  />

                  {/* Valeur TOUJOURS à l'extérieur de la barre : elle reste entière même
                      quand la marche ne fait que quelques pixels. */}
                  <text
                    x={Math.min(xDebut + longueur + 8, largeur - 4)}
                    y={y + HAUTEUR_MARCHE / 2 + 4}
                    textAnchor={xDebut + longueur + 8 > largeur - 72 ? "end" : "start"}
                    className={cn("num text-[11px]", total ? "fill-foreground font-medium" : "fill-muted-foreground")}
                  >
                    {formatEuros(marche.montant)}
                    {marche.type === "retrait" ? ` · ${formatPct(marche.part * 100)}` : ""}
                  </text>

                  {/* Filet de liaison vers la marche suivante : l'escalier se lit comme une
                      suite, pas comme cinq barres indépendantes. */}
                  {index < marches.length - 1 && marche.type !== "arrivee" && (
                    <line
                      x1={xDebut}
                      x2={xDebut}
                      y1={y + HAUTEUR_MARCHE}
                      y2={y + ESPACEMENT_MARCHE}
                      stroke="var(--color-border)"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {marcheActive && (
          <div
            role="tooltip"
            className="pointer-events-none absolute right-0 top-0 z-20 max-w-xs rounded-xl border border-border bg-popover p-3 shadow-lift"
          >
            <p className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-[3px]"
                  style={{ background: COULEUR_MARCHE[marcheActive.cle] }}
                />
                {marcheActive.label}
              </span>
              <span className="num text-xs font-medium text-foreground">
                {formatEuros(marcheActive.montant)}
              </span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {marcheActive.explication}
            </p>
          </div>
        )}
      </div>

      {!complet && (
        <p className="mt-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-ink">
          L'impôt sur le revenu n'étant pas calculable, la dernière marche est incomplète :
          ce qui vous reste sera inférieur au montant affiché.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setTableau((v) => !v)}
          aria-expanded={tableau}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {tableau ? "Masquer le tableau" : "Voir les valeurs en tableau"}
        </button>
      </div>

      {tableau && (
        <div className="mt-3 overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Détail de la cascade du chiffre d&apos;affaires</caption>
            <thead className="bg-secondary/80">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Poste</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Montant</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Part du CA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {marches.map((marche) => (
                <tr key={marche.cle}>
                  <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                    {marche.type === "retrait" ? `− ${marche.label}` : marche.label}
                  </th>
                  <td className="num px-3 py-2 text-right">{formatEuros(marche.montant)}</td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">
                    {formatPct(marche.part * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * L'abattement, seul, en une phrase chiffrée.
 *
 * Il ne peut PAS figurer dans la cascade : ce n'est pas de l'argent qui part, c'est une
 * part du chiffre d'affaires que le fisc ne regarde pas. Le mettre sur la même échelle que
 * les cotisations donnerait à lire « 34 % de mon CA disparaît », l'inverse de la vérité.
 * Une valeur unique, un chiffre-repère — pas une figure.
 */
export function RepereAbattement({
  lignes,
  caTotal,
}: {
  lignes: LigneAbattement[];
  caTotal: number;
}) {
  const abattement = lignes.reduce((s, l) => s + (l?.abattement ?? 0), 0);
  const base = lignes.reduce((s, l) => s + (l?.base_imposable ?? 0), 0);
  if (lignes.length === 0 || caTotal <= 0) return null;

  const taux = lignes[0]?.taux_abattement ?? null;

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4">
      <p className="rule-label text-muted-foreground">Avant tout calcul d&apos;impôt</p>
      <p className="mt-2 text-sm leading-relaxed">
        L&apos;administration retire{" "}
        <span className="num font-medium">{formatEuros(abattement)}</span>
        {taux !== null && <> ({formatPct(taux * 100)})</>} de votre chiffre d&apos;affaires.
        L&apos;impôt ne portera donc que sur{" "}
        <span className="num font-medium">{formatEuros(base)}</span>.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Cet abattement n&apos;est pas une dépense : cette somme reste sur votre compte. Elle
        remplace la déduction de vos frais réels.
      </p>
    </div>
  );
}

// ------------------------------------- Figure : versement libératoire ou barème

/**
 * Les deux façons de payer l'impôt, comparées.
 *
 * Deux valeurs seulement : la figure reste une paire de barres à échelle commune, avec
 * étiquettes directes. Le conseil — laquelle coûte le moins cher — vient du moteur, qui le
 * calculait déjà sans que personne ne l'affiche.
 */
export function ComparaisonOptions({ comparaison }: { comparaison: ComparaisonOption }) {
  const { montantBareme, montantVersementLiberatoire, recommandation, economie } = comparaison;

  if (montantBareme === null && montantVersementLiberatoire === null) {
    return (
      <p className="rounded-xl border border-border bg-secondary/40 p-4 text-xs leading-relaxed text-muted-foreground">
        {comparaison.motifIneligibilite ??
          "La comparaison demande le nombre de parts, les autres revenus du foyer et le revenu fiscal de référence N-2."}
      </p>
    );
  }

  const maximum = Math.max(montantBareme ?? 0, montantVersementLiberatoire ?? 0, 1);
  const options = [
    {
      cle: "bareme" as const,
      label: "Barème progressif",
      montant: montantBareme,
      couleur: "var(--color-dv-serie-1)",
      aide: "L'impôt suit votre tranche marginale et la situation de votre foyer.",
    },
    {
      cle: "versement_liberatoire" as const,
      label: "Versement libératoire",
      montant: montantVersementLiberatoire,
      couleur: "var(--color-dv-serie-2)",
      aide: "Un pourcentage fixe du chiffre d'affaires, payé avec les cotisations.",
    },
  ];

  return (
    <div>
      <ul className="space-y-4">
        {options.map((option) => {
          const recommandee = recommandation === option.cle;
          const largeur = option.montant === null ? 0 : (option.montant / maximum) * 100;
          return (
            <li key={option.cle}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: option.couleur }}
                  />
                  {option.label}
                  {recommandee && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[0.65rem] font-medium text-success-ink">
                      <ShieldCheck className="size-3" aria-hidden />
                      moins coûteux
                    </span>
                  )}
                </p>
                <p className="num text-sm font-medium">
                  {option.montant === null ? "non calculable" : formatEuros(option.montant)}
                </p>
              </div>
              <div
                className="mt-2 h-2.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--color-dv-track)" }}
                role="img"
                aria-label={`${option.label} : ${option.montant === null ? "non calculable" : formatEuros(option.montant)}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${largeur}%`,
                    background: option.couleur,
                    transition: "width 0.8s var(--ease-out-expo)",
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{option.aide}</p>
            </li>
          );
        })}
      </ul>

      {economie !== null && economie > 0 && recommandation && (
        <p className="mt-5 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success-ink">
          L'option la moins coûteuse vous fait économiser{" "}
          <span className="num font-medium">{formatEuros(economie)}</span> sur l'année.
          {comparaison.optionRetenue && comparaison.optionRetenue !== recommandation && (
            <> Votre option actuelle n'est pas celle-là.</>
          )}
        </p>
      )}

      {comparaison.eligible === false && comparaison.motifIneligibilite && (
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {comparaison.motifIneligibilite}
        </p>
      )}
      {comparaison.eligible === null && (
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          Éligibilité au versement libératoire indéterminée : le revenu fiscal de référence
          N-2 est nécessaire pour trancher.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Bloc « Pourquoi »

/**
 * Le détail du calcul, replié par défaut.
 *
 * Il ne sert pas à tous : celui qui veut son chiffre l'a déjà au-dessus. Il sert à celui
 * qui doute — et pour lui, c'est la différence entre un outil qu'on croit et un outil qu'on
 * vérifie. D'où la provenance des taux en fin de bloc, y compris quand elle est mauvaise.
 */
export function DetailCalcul({
  etapes,
  sources,
  titre = "Comment ce chiffre est obtenu",
}: {
  etapes: EtapeCalcul[];
  sources: SourceChiffres[];
  titre?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  if (etapes.length === 0) return null;

  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="flex items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{titre}</span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            ouvert && "rotate-180",
          )}
        />
      </button>

      {ouvert && (
        <div className="border-t border-border p-5">
          <ol className="space-y-4">
            {etapes.map((etape, index) => (
              <li key={etape.cle} className="flex gap-3">
                <span
                  aria-hidden
                  className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] text-muted-foreground"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{etape.titre}</span>
                    <span
                      className={cn(
                        "num text-sm",
                        etape.nonCalculable ? "text-warning-ink" : "text-foreground",
                      )}
                    >
                      {etape.valeur ?? "non calculable"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {etape.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {sources.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="rule-label text-muted-foreground">D'où viennent ces taux</p>
              <ul className="mt-3 space-y-2">
                {sources.map((source) => (
                  <li key={source.cle} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="text-foreground">{source.libelle}</span>
                    {source.annee !== null && (
                      <span className="num text-muted-foreground">{source.annee}</span>
                    )}
                    {source.dateVerification && (
                      <span className="text-muted-foreground">
                        · relevé le {source.dateVerification}
                      </span>
                    )}
                    {source.verifie === false && (
                      <span className="text-warning-ink">
                        · pas encore recoupé avec la source officielle
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
