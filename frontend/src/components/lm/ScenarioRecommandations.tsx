/**
 * La réponse d'ensemble et les recommandations.
 *
 * Trois partis pris, tenus dans tout ce fichier :
 *
 * 1. **Le verdict ne décide jamais à la place de l'utilisateur.** Il ne dit pas « signez » :
 *    signer dépend de choses qu'aucun chiffre ne connaît — l'envie, le client, la charge de
 *    travail. Il dit ce que le scénario rapporte, et combien de points restent à régler.
 *
 * 2. **Chaque recommandation montre sa source.** « moteur fiscal », « vos factures »,
 *    « votre profil », « votre trésorerie » : l'utilisateur doit savoir d'où sort une
 *    affirmation, donc quoi corriger si elle est fausse.
 *
 * 3. **Constat, conséquence, action — les trois, toujours.** Une recommandation sans action
 *    est un reproche ; une action sans constat est une injonction. Le format impose les
 *    trois, et une règle incapable de les produire ne s'affiche pas.
 */

import { useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Gravite, Recommandation, Verdict } from "@/lib/recommandations";

const STYLE_GRAVITE: Record<
  Gravite,
  { bordure: string; fond: string; texte: string; icone: typeof Info; label: string }
> = {
  critique: {
    bordure: "border-destructive/40",
    fond: "bg-destructive/10",
    texte: "text-destructive",
    icone: TriangleAlert,
    label: "Bloquant",
  },
  attention: {
    bordure: "border-warning/40",
    fond: "bg-warning/10",
    texte: "text-warning-ink",
    icone: CircleAlert,
    label: "À vérifier",
  },
  favorable: {
    bordure: "border-success/30",
    fond: "bg-success/10",
    texte: "text-success-ink",
    icone: CircleCheck,
    label: "Favorable",
  },
  info: {
    bordure: "border-border",
    fond: "bg-secondary/40",
    texte: "text-muted-foreground",
    icone: Info,
    label: "Bon à savoir",
  },
};

/**
 * La réponse à la question posée. DEUX chiffres, pas davantage.
 *
 * L'écran affichait auparavant quatre tuiles de provision, une par scénario, en plus du
 * verdict et de quatre figures. C'était trop : un micro-entrepreneur qui se demande s'il
 * signe a besoin de deux nombres — ce qu'il gagne, et ce qu'il doit mettre de côté. Le
 * reste est du détail, et le détail a sa place plus bas.
 */
export function CarteVerdict({
  verdict,
  provisionMensuelle,
}: {
  verdict: Verdict;
  /** Déjà formaté par l'appelant. `null` si non calculable. */
  provisionMensuelle: string | null;
}) {
  const style = STYLE_GRAVITE[verdict.gravite];
  const Icone = style.icone;

  return (
    <section
      className={cn(
        "animate-rise rounded-2xl border p-6 shadow-soft",
        style.bordure,
        style.fond,
      )}
    >
      <p className="rule-label flex items-center gap-2 text-muted-foreground">
        <Icone className={cn("size-4 shrink-0", style.texte)} aria-hidden />
        La réponse à votre question
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
        {verdict.chiffre && (
          <p>
            {/* Chiffre-repère : chasse proportionnelle, pas tabulaire — il est seul. */}
            <span className="block text-4xl font-medium tracking-tight">{verdict.chiffre}</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {verdict.chiffreLibelle}
            </span>
          </p>
        )}
        {provisionMensuelle && (
          <p>
            <span className="block text-2xl font-medium tracking-tight">
              {provisionMensuelle}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              à mettre de côté chaque mois
            </span>
          </p>
        )}
      </div>

      <p className="mt-5 text-sm leading-relaxed text-pretty">{verdict.reponse}</p>

      {(verdict.bloquants > 0 || verdict.vigilances > 0) && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {verdict.bloquants > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-card px-3 py-1 text-xs text-destructive">
              <TriangleAlert className="size-3" aria-hidden />
              {verdict.bloquants} bloquant{verdict.bloquants > 1 ? "s" : ""}
            </li>
          )}
          {verdict.vigilances > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-card px-3 py-1 text-xs text-warning-ink">
              <CircleAlert className="size-3" aria-hidden />
              {verdict.vigilances} à vérifier
            </li>
          )}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Cette synthèse rapproche des faits — elle ne prend pas la décision à votre place, et
        ne remplace pas l'avis d'un expert-comptable.
      </p>
    </section>
  );
}

function CarteRecommandation({ recommandation }: { recommandation: Recommandation }) {
  const [ouvert, setOuvert] = useState(recommandation.gravite === "critique");
  const style = STYLE_GRAVITE[recommandation.gravite];
  const Icone = style.icone;

  return (
    <li className={cn("overflow-hidden rounded-xl border", style.bordure)}>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className={cn(
          "flex w-full items-start gap-3 p-4 text-left transition-colors",
          style.fond,
          "hover:brightness-[0.98]",
        )}
      >
        <Icone className={cn("mt-0.5 size-4 shrink-0", style.texte)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{recommandation.titre}</span>
            {/* La gravité ne repose jamais sur la seule couleur : icône + mot. */}
            <span className={cn("rule-label", style.texte)}>{style.label}</span>
          </span>
          {!ouvert && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {recommandation.constat}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            ouvert && "rotate-180",
          )}
        />
      </button>

      {ouvert && (
        <div className="space-y-3 border-t border-border bg-card p-4">
          <div>
            <p className="rule-label text-muted-foreground">Constat</p>
            <p className="mt-1 text-sm leading-relaxed">{recommandation.constat}</p>
          </div>
          <div>
            <p className="rule-label text-muted-foreground">Ce que ça implique</p>
            <p className="mt-1 text-sm leading-relaxed text-pretty">
              {recommandation.consequence}
            </p>
          </div>
          <div>
            <p className="rule-label text-muted-foreground">Ce que vous pouvez faire</p>
            <p className="mt-1 text-sm leading-relaxed text-pretty">{recommandation.action}</p>
          </div>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Source : {recommandation.source}
          </p>
        </div>
      )}
    </li>
  );
}

/** Au-delà, la liste cesse d'être une liste de priorités pour devenir un mur de texte. */
const VISIBLES_D_EMBLEE = 3;

export function ListeRecommandations({
  recommandations,
}: {
  recommandations: Recommandation[];
}) {
  const [tout, setTout] = useState(false);

  if (recommandations.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-secondary/40 p-5 text-sm leading-relaxed text-muted-foreground">
        Aucun point particulier détecté sur ce scénario, au vu de vos factures et de votre
        profil. C'est un résultat, pas une absence d'analyse : les règles qui n'ont rien à
        signaler restent silencieuses.
      </p>
    );
  }

  // La liste est déjà triée par gravité : couper la fin ne masque jamais un bloquant.
  const affichees = tout ? recommandations : recommandations.slice(0, VISIBLES_D_EMBLEE);
  const restantes = recommandations.length - affichees.length;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {affichees.map((recommandation) => (
          <CarteRecommandation key={recommandation.id} recommandation={recommandation} />
        ))}
      </ul>
      {restantes > 0 && (
        <button
          type="button"
          onClick={() => setTout(true)}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Voir {restantes} point{restantes > 1 ? "s" : ""} de moindre importance
        </button>
      )}
    </div>
  );
}
