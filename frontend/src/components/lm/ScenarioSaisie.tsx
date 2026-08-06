/**
 * Saisie d'un scénario en français, et correction de ce qui a été compris.
 *
 * L'ancienne version posait trois champs (montant, nature, nom) à côté de la phrase. Ils
 * ont disparu, mais leur RAISON D'ÊTRE demeure : si le modèle lit « vente de marchandises »
 * là où l'utilisateur voulait dire « prestation libérale », l'abattement passe de 34 % à
 * 71 % et le résultat est faux sans que rien ne le signale.
 *
 * D'où le parti pris de ce fichier : la compréhension s'affiche en toutes lettres, et
 * chaque élément de la phrase reste corrigeable d'un clic. Deux garde-fous s'ajoutent :
 *
 *  - la PROVENANCE de chaque élément — lu dans la phrase, ou supposé par le modèle. Une
 *    supposition porte une marque visible ; c'est elle qu'il faut relire en priorité.
 *  - les contre-scénarios proposés arrivent DÉSACTIVÉS. L'utilisateur les accepte s'il les
 *    veut ; il ne se retrouve jamais devant des chiffres qu'il n'a pas demandés.
 */

import { useState } from "react";
import { Check, CircleHelp, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/finance";
import { couleurSerie, MAX_SERIES } from "@/lib/scenarios-series";
import {
  CATEGORIE_LIBELLE,
  interpreterPhrase,
  type CategorieFiscale,
  type ElementCompris,
  type ScenarioInterprete,
} from "@/lib/scenarios";

const CATEGORIES: CategorieFiscale[] = ["BNC", "BIC_SERVICE", "BIC_VENTE"];

const EXEMPLES = [
  "Si je signe ce contrat de 5 000 € avec un client français, combien je garde ?",
  "Un partenariat à 2 000 € par mois pendant 6 mois",
  "Deux clients, un à 3 000 € et un autre à 8 000 € en vente de produits",
];

/** Marque de provenance. Une supposition doit se voir sans avoir à la chercher. */
function MarqueProvenance({ element }: { element: ElementCompris }) {
  if (element.provenance === "explicite") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground"
        title="Lu dans votre phrase"
      >
        <Check className="size-3" aria-hidden />
        <span className="sr-only">Lu dans votre phrase</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 text-[0.65rem] font-medium text-warning-ink"
      title="Supposé — vérifiez cet élément"
    >
      <CircleHelp className="size-3" aria-hidden />
      supposé
    </span>
  );
}

/**
 * Un élément compris, corrigeable sur place.
 *
 * Seule la nature ouvre un choix : c'est le seul paramètre dont une erreur change le
 * résultat sans être visible. Le montant et la récurrence se corrigent en reformulant la
 * phrase — les retoucher au clavier ici reviendrait à réintroduire le formulaire supprimé.
 */
function ElementCorrigeable({
  element,
  onCorrigerCategorie,
}: {
  element: ElementCompris;
  onCorrigerCategorie?: (categorie: CategorieFiscale) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const corrigeable = element.champ === "categorie" && onCorrigerCategorie != null;

  if (!corrigeable) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium">{element.libelle}</span>
        <MarqueProvenance element={element} />
      </span>
    );
  }

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-label={`Corriger la nature de l'activité : ${element.libelle}`}
        className={cn(
          "rounded-md px-1.5 py-0.5 font-medium underline decoration-dotted underline-offset-4 transition-colors",
          element.provenance === "suppose"
            ? "text-warning-ink hover:bg-warning/15"
            : "hover:bg-secondary",
        )}
      >
        {element.libelle}
      </button>
      <MarqueProvenance element={element} />

      {ouvert && (
        <span className="absolute left-0 top-full z-20 mt-1 min-w-[13rem] rounded-xl border border-border bg-popover p-1 shadow-lift">
          {CATEGORIES.map((categorie) => (
            <button
              key={categorie}
              type="button"
              onClick={() => {
                onCorrigerCategorie(categorie);
                setOuvert(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
            >
              {CATEGORIE_LIBELLE[categorie]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function CarteScenario({
  scenario,
  index,
  retenu,
  onBasculer,
  onCorrigerCategorie,
}: {
  scenario: ScenarioInterprete;
  index: number;
  retenu: boolean;
  onBasculer: () => void;
  onCorrigerCategorie: (categorie: CategorieFiscale) => void;
}) {
  const elements = scenario.elements ?? [];
  const suppositions = elements.filter((e) => e.provenance === "suppose").length;

  return (
    <li
      className={cn(
        "rounded-xl border p-4 transition-colors",
        retenu ? "border-ink bg-card" : "border-dashed border-border bg-background",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {retenu && (
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-[3px]"
              style={{ background: couleurSerie(index) }}
            />
          )}
          <p className="truncate text-sm font-medium">{scenario.libelle}</p>
          {scenario.propose && (
            <span className="rule-label shrink-0 text-muted-foreground">suggestion</span>
          )}
        </div>
        <button
          type="button"
          onClick={onBasculer}
          aria-pressed={retenu}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            retenu
              ? "border border-border text-muted-foreground hover:border-ink hover:text-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {retenu ? "Retirer" : "Comparer"}
        </button>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm leading-relaxed">
        {elements.map((element, i) => (
          <span key={element.champ} className="inline-flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">·</span>}
            <ElementCorrigeable
              element={element}
              onCorrigerCategorie={element.champ === "categorie" ? onCorrigerCategorie : undefined}
            />
          </span>
        ))}
      </p>

      {scenario.recurrent && scenario.ca_annuel !== scenario.montant && (
        <p className="mt-2 text-xs text-muted-foreground">
          Soit <span className="num">{formatEuros(scenario.ca_annuel)}</span> ajoutés au chiffre
          d'affaires de l'année.
        </p>
      )}

      {suppositions > 0 && (
        <p className="mt-2 text-xs text-warning-ink">
          {suppositions === 1
            ? "1 élément a été supposé : relisez-le avant de vous fier au résultat."
            : `${suppositions} éléments ont été supposés : relisez-les avant de vous fier au résultat.`}
        </p>
      )}
    </li>
  );
}

export function ScenarioSaisie({
  phrase,
  onPhraseChange,
  scenarios,
  retenus,
  onBasculerScenario,
  onCorrigerCategorie,
  onInterpretation,
  resume,
  desactive,
}: {
  phrase: string;
  onPhraseChange: (phrase: string) => void;
  /** Scénarios compris + contre-scénarios proposés, dans l'ordre d'affichage. */
  scenarios: ScenarioInterprete[];
  retenus: string[];
  onBasculerScenario: (id: string) => void;
  onCorrigerCategorie: (id: string, categorie: CategorieFiscale) => void;
  onInterpretation: (scenarios: ScenarioInterprete[], resume: string | null) => void;
  resume: string | null;
  desactive: boolean;
}) {
  const [enCours, setEnCours] = useState(false);
  const [avertissement, setAvertissement] = useState<string | null>(null);

  const interpreter = async () => {
    setEnCours(true);
    setAvertissement(null);
    try {
      const resultat = await interpreterPhrase(phrase);
      const compris = [
        ...(resultat.scenarios ?? []),
        // Les suggestions arrivent après ce que la phrase dit, et désactivées.
        ...(resultat.contre_scenarios ?? []),
      ];
      if (!resultat.comprise || compris.length === 0) {
        onInterpretation([], null);
        setAvertissement(resultat.motif ?? "Phrase non interprétée. Reformulez-la.");
        return;
      }
      onInterpretation(compris, resultat.resume ?? null);
    } catch {
      onInterpretation([], null);
      setAvertissement("L'interprétation a échoué. Réessayez dans un moment.");
    } finally {
      setEnCours(false);
    }
  };

  const placesRestantes = MAX_SERIES - 1 - retenus.length;

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <label htmlFor="sim-situation" className="rule-label text-muted-foreground">
        Votre situation
      </label>
      <textarea
        id="sim-situation"
        rows={3}
        value={phrase}
        onChange={(e) => onPhraseChange(e.target.value)}
        placeholder={EXEMPLES[0]}
        className="mt-3 w-full resize-none border-b border-border bg-transparent py-3 text-base transition-colors duration-200 focus:border-ink focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={interpreter} disabled={enCours || phrase.trim().length < 3 || desactive}>
          {enCours ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Analyser ma situation
        </Button>
        <p className="text-xs text-muted-foreground">
          La phrase est traduite en paramètres. Les montants, eux, viennent du moteur fiscal.
        </p>
      </div>

      {scenarios.length === 0 && !avertissement && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {EXEMPLES.map((exemple) => (
            <li key={exemple}>
              <button
                type="button"
                onClick={() => onPhraseChange(exemple)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
              >
                {exemple.length > 46 ? `${exemple.slice(0, 45)}…` : exemple}
              </button>
            </li>
          ))}
        </ul>
      )}

      {avertissement && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-ink">
          <X className="mt-0.5 size-4 shrink-0" />
          {avertissement}
        </p>
      )}

      {scenarios.length > 0 && (
        <section className="mt-6">
          <h2 className="rule-label text-muted-foreground">Ce que j'ai compris</h2>
          {resume && <p className="mt-2 text-sm leading-relaxed text-pretty">{resume}</p>}

          <ul className="mt-4 space-y-3">
            {scenarios.map((scenario) => {
              const rang = retenus.indexOf(scenario.id);
              return (
                <CarteScenario
                  key={scenario.id}
                  scenario={scenario}
                  index={rang >= 0 ? rang + 1 : 0}
                  retenu={rang >= 0}
                  onBasculer={() => onBasculerScenario(scenario.id)}
                  onCorrigerCategorie={(categorie) => onCorrigerCategorie(scenario.id, categorie)}
                />
              );
            })}
          </ul>

          {placesRestantes <= 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Plus className="size-3" />
              Trois scénarios comparés au maximum : au-delà, les courbes ne se distinguent plus
              de façon fiable.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
