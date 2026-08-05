/**
 * Saisie d'un scénario : une phrase, puis un formulaire qui montre ce qui a été compris.
 *
 * L'architecture est volontairement dissymétrique. Le modèle TRADUIT la phrase en
 * paramètres (montant, catégorie, récurrence) ; il ne produit jamais un montant d'impôt,
 * qui reste l'affaire exclusive du moteur. Et parce qu'une interprétation peut se tromper,
 * elle atterrit dans des champs éditables plutôt que dans un résultat : corriger « vente »
 * en « prestation » doit coûter un clic, pas une reformulation de la phrase.
 *
 * Le formulaire fonctionne seul. Si le modèle est indisponible — pas de clé, quota, réseau —
 * la saisie directe reste entièrement utilisable, et l'écran le dit.
 */

import { useState } from "react";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/finance";
import { couleurSerie, MAX_SERIES } from "@/lib/scenarios-series";
import {
  CATEGORIE_LIBELLE,
  interpreterPhrase,
  type CategorieFiscale,
  type VarianteScenario,
} from "@/lib/scenarios";

const CATEGORIES: CategorieFiscale[] = ["BNC", "BIC_SERVICE", "BIC_VENTE"];

const champStyle =
  "w-full rounded-lg border border-transparent bg-background px-3 py-2 text-sm input-boxed";

type BrouillonScenario = {
  montant: string;
  categorie: CategorieFiscale;
  libelle: string;
};

const BROUILLON_VIDE: BrouillonScenario = {
  montant: "",
  categorie: "BNC",
  libelle: "",
};

export function ScenarioSaisie({
  variantes,
  onAjouter,
  onRetirer,
  categorieParDefaut,
  desactive,
}: {
  variantes: VarianteScenario[];
  onAjouter: (variante: VarianteScenario) => void;
  onRetirer: (id: string) => void;
  categorieParDefaut: CategorieFiscale;
  desactive: boolean;
}) {
  const [phrase, setPhrase] = useState(
    "Si je signe ce contrat de 5000 € avec un client français, combien je garde ?",
  );
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [avertissement, setAvertissement] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [brouillon, setBrouillon] = useState<BrouillonScenario>({
    ...BROUILLON_VIDE,
    categorie: categorieParDefaut,
  });

  // Le nombre de variantes est plafonné par le nombre de teintes catégorielles validées :
  // au-delà, il faudrait cycler les couleurs, ce que la charte dataviz interdit.
  const placesRestantes = MAX_SERIES - 1 - variantes.length;

  const interpreter = async () => {
    setEnCours(true);
    setAvertissement(null);
    try {
      const resultat = await interpreterPhrase(phrase);
      if (!resultat.comprise || resultat.montant == null) {
        setInterpretation(null);
        setAvertissement(resultat.motif ?? "Phrase non interprétée. Renseignez les champs.");
        return;
      }
      setBrouillon({
        montant: String(resultat.montant),
        categorie: resultat.categorie ?? categorieParDefaut,
        libelle: resultat.libelle ?? `Contrat ${formatEuros(resultat.montant)}`,
      });
      setInterpretation(resultat.resume ?? null);
    } catch {
      setInterpretation(null);
      setAvertissement("L'interprétation a échoué. Renseignez les champs ci-dessous.");
    } finally {
      setEnCours(false);
    }
  };

  const montant = Number(brouillon.montant.replace(",", "."));
  const montantValide = Number.isFinite(montant) && montant > 0;

  const ajouter = () => {
    if (!montantValide || placesRestantes <= 0) return;
    onAjouter({
      id: `v-${Date.now()}`,
      libelle: brouillon.libelle.trim() || `+ ${formatEuros(montant)}`,
      ajouts: [{ categorie: brouillon.categorie, ca: montant }],
    });
    setBrouillon({ ...BROUILLON_VIDE, categorie: categorieParDefaut });
    setInterpretation(null);
  };

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <label htmlFor="sim-situation" className="rule-label text-muted-foreground">
        Votre situation
      </label>
      <textarea
        id="sim-situation"
        rows={3}
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        className="mt-3 w-full resize-none border-b border-border bg-transparent py-3 text-base transition-colors duration-200 focus:border-ink focus:outline-none"
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={interpreter} disabled={enCours || phrase.trim().length < 3}>
          {enCours ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Interpréter la phrase
        </Button>
        <p className="text-xs text-muted-foreground">
          L'interprétation remplit les champs ci-dessous. Le calcul, lui, vient du moteur fiscal.
        </p>
      </div>

      {interpretation && (
        <p className="mt-4 rounded-xl border border-border bg-secondary/50 p-3 text-sm">
          <span className="rule-label mr-2 text-muted-foreground">Compris</span>
          {interpretation}{" "}
          <span className="text-muted-foreground">— corrigez si besoin.</span>
        </p>
      )}
      {avertissement && (
        <p className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-ink">
          {avertissement}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1.4fr_1.6fr_auto] sm:items-end">
        <div>
          <label htmlFor="sim-montant" className="rule-label text-muted-foreground">
            Montant HT
          </label>
          <input
            id="sim-montant"
            inputMode="decimal"
            value={brouillon.montant}
            onChange={(e) => setBrouillon((b) => ({ ...b, montant: e.target.value }))}
            placeholder="5000"
            className={cn(champStyle, "num mt-2")}
          />
        </div>
        <div>
          <label htmlFor="sim-categorie" className="rule-label text-muted-foreground">
            Nature
          </label>
          <select
            id="sim-categorie"
            value={brouillon.categorie}
            onChange={(e) =>
              setBrouillon((b) => ({ ...b, categorie: e.target.value as CategorieFiscale }))
            }
            className={cn(champStyle, "mt-2")}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORIE_LIBELLE[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sim-libelle" className="rule-label text-muted-foreground">
            Nom du scénario
          </label>
          <input
            id="sim-libelle"
            value={brouillon.libelle}
            onChange={(e) => setBrouillon((b) => ({ ...b, libelle: e.target.value }))}
            placeholder="Contrat 5 000 €"
            className={cn(champStyle, "mt-2")}
          />
        </div>
        <Button
          onClick={ajouter}
          disabled={!montantValide || placesRestantes <= 0 || desactive}
          className="sm:mb-0"
        >
          <Plus /> Ajouter
        </Button>
      </div>

      {placesRestantes <= 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Trois scénarios comparés au maximum : au-delà, les courbes ne se distinguent plus de
          façon fiable. Retirez-en un pour en tester un autre.
        </p>
      )}

      {variantes.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {variantes.map((variante, index) => (
            <li key={variante.id}>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-3 pr-1.5 text-xs">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: couleurSerie(index + 1) }}
                />
                {variante.libelle}
                <button
                  type="button"
                  onClick={() => onRetirer(variante.id)}
                  aria-label={`Retirer le scénario ${variante.libelle}`}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
