/**
 * Les figures, une à la fois, derrière des onglets.
 *
 * --- POURQUOI CE CHANGEMENT ---
 *
 * L'écran empilait treize blocs et quatre figures les unes sous les autres. Deux
 * conséquences, toutes deux mauvaises :
 *
 *  1. Personne ne lisait quoi que ce soit. Une page qui montre tout ne met rien en avant,
 *     et un micro-entrepreneur qui veut savoir s'il signe n'a pas trente secondes à donner
 *     à un défilement.
 *  2. Chaque figure était à l'étroit. À quatre graphes empilés, aucun n'avait la place de
 *     respirer, alors qu'ils sont précisément là pour rendre les chiffres évidents.
 *
 * Un seul graphe visible à la fois, sur toute la largeur, avec un onglet par question que
 * l'utilisateur se pose réellement. Les onglets portent ces questions, pas les noms des
 * figures : « Où va l'argent » plutôt que « Décomposition du chiffre d'affaires ».
 *
 * Les onglets sans donnée ne s'affichent pas — un onglet vide est pire qu'un onglet absent.
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CircleAlert } from "lucide-react";
import { BarresDecomposition, CourbeProjection } from "@/components/lm/ScenariosCharts";
import { CascadeFiscale, ComparaisonOptions } from "@/components/lm/ScenariosAnalyse";
import type {
  ComparaisonOption,
  DecompositionScenario,
  MarcheCascade,
  Projection,
} from "@/lib/scenarios";

type CleOnglet = "argent" | "annee" | "comparer" | "impot";

type Onglet = {
  cle: CleOnglet;
  label: string;
  aide: string;
};

export function PanneauFigures({
  cascade,
  cascadeComplete,
  projection,
  decompositions,
  comparaison,
  nbScenarios,
}: {
  cascade: MarcheCascade[];
  cascadeComplete: boolean;
  projection: Projection;
  decompositions: DecompositionScenario[];
  comparaison: ComparaisonOption | null;
  nbScenarios: number;
}) {
  // Mémorisé : sans cela le tableau est neuf à chaque rendu et l'effet de repli ci-dessous
  // se déclenche en boucle.
  const onglets: Onglet[] = useMemo(() => {
    const liste: Onglet[] = [];
    if (cascade.length > 0) {
      liste.push({
        cle: "argent",
        label: "Où va l'argent",
        aide: "Ce qui est prélevé, et ce qui vous reste.",
      });
    }
    // La projection s'affiche DÈS le premier scénario. Elle était auparavant réservée aux
    // comparaisons, si bien que l'écran s'ouvrait sans le moindre graphe.
    if (projection.series.length > 0) {
      liste.push({
        cle: "annee",
        label: "Sur l'année",
        aide: "Votre chiffre d'affaires cumulé, face au plafond de votre régime.",
      });
    }
    if (nbScenarios > 1 && decompositions.length > 1) {
      liste.push({
        cle: "comparer",
        label: "Comparer",
        aide: "Les scénarios côte à côte, au même niveau de détail.",
      });
    }
    if (comparaison) {
      liste.push({
        cle: "impot",
        label: "Payer l'impôt",
        aide: "Les deux façons de le payer, et celle qui vous coûte le moins.",
      });
    }
    return liste;
  }, [cascade.length, projection.series.length, nbScenarios, decompositions.length, comparaison]);

  const [actif, setActif] = useState<CleOnglet>(onglets[0]?.cle ?? "argent");

  // Un onglet peut disparaître quand l'utilisateur retire un scénario : on ne reste pas
  // sur un onglet qui n'existe plus.
  useEffect(() => {
    if (!onglets.some((o) => o.cle === actif) && onglets[0]) setActif(onglets[0].cle);
  }, [onglets, actif]);

  if (onglets.length === 0) return null;
  const courant = onglets.find((o) => o.cle === actif) ?? onglets[0];

  return (
    <section className="animate-rise rounded-2xl border border-border bg-card shadow-soft">
      <div
        className="flex flex-wrap items-center gap-1.5 border-b border-border p-4"
        role="tablist"
        aria-label="Choisir la figure à afficher"
      >
        {onglets.map((onglet) => (
          <button
            key={onglet.cle}
            type="button"
            role="tab"
            aria-selected={actif === onglet.cle}
            onClick={() => setActif(onglet.cle)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[0.8125rem] font-medium transition-all duration-200 active:scale-[0.97]",
              actif === onglet.cle
                ? "bg-primary text-primary-foreground shadow-soft"
                : "border border-border text-muted-foreground hover:border-ink hover:text-foreground",
            )}
          >
            {onglet.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        <p className="mb-6 text-[0.9375rem] text-muted-foreground">{courant?.aide}</p>

        {actif === "argent" && (
          <CascadeFiscale marches={cascade} complet={cascadeComplete} />
        )}

        {actif === "annee" && (
          <>
            <CourbeProjection projection={projection} hauteur={320} />
            {projection.series.some((s) => s.moisFranchissement !== null) && (
              <ul className="mt-4 space-y-2">
                {projection.series
                  .filter((s) => s.moisFranchissement !== null)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[0.8125rem] text-warning-ink"
                    >
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <strong>{s.libelle}</strong> franchirait le plafond en{" "}
                        {s.points[s.moisFranchissement ?? 0]?.label}. Un dépassement n'est pas
                        une sortie du régime — celle-ci suppose deux années consécutives.
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}

        {actif === "comparer" && <BarresDecomposition decompositions={decompositions} />}

        {actif === "impot" && comparaison && <ComparaisonOptions comparaison={comparaison} />}
      </div>
    </section>
  );
}
