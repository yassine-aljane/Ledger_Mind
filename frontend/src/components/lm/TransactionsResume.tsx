/**
 * En-tête de l'écran Transactions : ce que la période contient, et ce qui y cloche.
 *
 * Les anomalies affichées ici sont celles que l'agent a relevées à la capture. Elles
 * étaient calculées puis jamais montrées — le bandeau est cliquable pour basculer la
 * liste sur les seules lignes concernées.
 */

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, FileWarning, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/finance";
import type { AnomalieAgregee, TotauxFlux } from "@/lib/transactions";

export function TotauxPeriode({ totaux }: { totaux: TotauxFlux }) {
  const cartes = [
    {
      cle: "entrees",
      label: "Entrées",
      valeur: totaux.entrees,
      icone: <ArrowDownLeft className="size-4" />,
      ton: "text-success-ink",
    },
    {
      cle: "sorties",
      label: "Sorties",
      valeur: totaux.sorties,
      icone: <ArrowUpRight className="size-4" />,
      ton: "text-destructive",
    },
    {
      cle: "solde",
      label: "Solde",
      valeur: totaux.solde,
      icone: <Scale className="size-4" />,
      ton: totaux.solde >= 0 ? "text-success-ink" : "text-destructive",
    },
  ];

  return (
    <div className="animate-rise grid gap-3 sm:grid-cols-3">
      {cartes.map((carte) => (
        <div
          key={carte.cle}
          className="rounded-2xl border border-border bg-card p-4 shadow-soft"
        >
          <p className="rule-label-lg flex items-center gap-2 text-label-ink">
            <span className={carte.ton}>{carte.icone}</span>
            {carte.label}
          </p>
          <p className={cn("num mt-2 text-2xl", carte.ton)}>{formatEuros(carte.valeur)}</p>
        </div>
      ))}

      {totaux.nbSansMontant > 0 && (
        <p className="text-[0.8125rem] text-muted-foreground sm:col-span-3">
          {totaux.nbSansMontant === 1
            ? "1 transaction sans montant lisible n'est pas comptée dans ce solde."
            : `${totaux.nbSansMontant} transactions sans montant lisible ne sont pas comptées dans ce solde.`}
        </p>
      )}
    </div>
  );
}

export function BandeauAnomalies({
  anomalies,
  actif,
  onBasculer,
}: {
  anomalies: AnomalieAgregee[];
  actif: boolean;
  onBasculer: () => void;
}) {
  if (anomalies.length === 0) return null;

  const total = anomalies.reduce((somme, a) => somme + a.occurrences, 0);

  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-pressed={actif}
      className={cn(
        "animate-rise w-full rounded-2xl border p-4 text-left transition-colors",
        actif
          ? "border-warning bg-warning/15"
          : "border-warning/40 bg-warning/8 hover:border-warning",
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-medium text-warning-ink">
            {total === 1
              ? "1 point à vérifier sur cette période"
              : `${total} points à vérifier sur cette période`}
          </p>
          <ul className="mt-2 space-y-1">
            {anomalies.slice(0, 4).map((a) => (
              <li key={a.message} className="flex gap-2 text-[0.8125rem] text-muted-foreground">
                <span className="min-w-0 flex-1">{a.message}</span>
                {a.occurrences > 1 && (
                  <span className="num shrink-0 text-warning-ink">×{a.occurrences}</span>
                )}
              </li>
            ))}
          </ul>
          {anomalies.length > 4 && (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              et {anomalies.length - 4} autre{anomalies.length - 4 > 1 ? "s" : ""}…
            </p>
          )}
          <p className="mt-3 text-[0.8125rem] font-medium text-warning-ink">
            {actif ? "Afficher toutes les transactions" : "N'afficher que ces transactions"}
          </p>
        </div>
      </div>
    </button>
  );
}

export function BandeauJustificatifs({
  nombre,
  actif,
  onBasculer,
}: {
  nombre: number;
  actif: boolean;
  onBasculer: () => void;
}) {
  if (nombre === 0) return null;

  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-pressed={actif}
      className={cn(
        "animate-rise flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
        actif ? "border-ink bg-secondary" : "border-border bg-card hover:border-ink",
      )}
    >
      <FileWarning className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-[0.9375rem]">
        {nombre === 1
          ? "1 transaction sans justificatif attaché."
          : `${nombre} transactions sans justificatif attaché.`}{" "}
        <span className="text-muted-foreground">
          En cas de contrôle, c'est la pièce qui manque.
        </span>
      </p>
      <Badge variant={actif ? "default" : "outline"} className="shrink-0">
        {actif ? "Filtré" : "Voir"}
      </Badge>
    </button>
  );
}
