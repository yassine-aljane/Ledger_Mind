/**
 * Barre de filtres de l'écran Transactions.
 *
 * Composant contrôlé : il ne détient aucun état, la route reste seule propriétaire des
 * filtres — le bandeau d'anomalies les modifie lui aussi, et deux sources de vérité
 * pour un même filtre finiraient par diverger.
 */

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PERIODES_TRANSACTIONS,
  SOURCE_LIBELLE,
  type FiltresTransactions,
  type SensFlux,
  type SourceTransaction,
} from "@/lib/transactions";

const SENS: { cle: SensFlux | "tous"; label: string }[] = [
  { cle: "tous", label: "Tout" },
  { cle: "entrant", label: "Entrées" },
  { cle: "sortant", label: "Sorties" },
];

const SOURCES: (SourceTransaction | "toutes")[] = [
  "toutes",
  "facture_emise",
  "facture_recue",
  "virement",
  "cadeau",
  "contrat",
];

function Chip({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        "rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-200 active:scale-[0.97]",
        actif
          ? "bg-primary text-primary-foreground shadow-soft"
          : "border border-border text-muted-foreground hover:border-ink hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function TransactionsFiltres({
  filtres,
  onChange,
  nbSansJustificatif,
  nbAvecAnomalie,
}: {
  filtres: FiltresTransactions;
  onChange: (filtres: FiltresTransactions) => void;
  nbSansJustificatif: number;
  nbAvecAnomalie: number;
}) {
  const maj = (partiel: Partial<FiltresTransactions>) => onChange({ ...filtres, ...partiel });

  return (
    <div className="animate-rise space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sens du flux">
          {SENS.map((s) => (
            <Chip key={s.cle} actif={filtres.sens === s.cle} onClick={() => maj({ sens: s.cle })}>
              {s.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Période">
          {PERIODES_TRANSACTIONS.map((p) => (
            <Chip
              key={p.cle}
              actif={filtres.periode === p.cle}
              onClick={() => maj({ periode: p.cle })}
            >
              {p.libelle}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Type de pièce">
        {SOURCES.map((s) => (
          <Chip key={s} actif={filtres.source === s} onClick={() => maj({ source: s })}>
            {s === "toutes" ? "Toutes les pièces" : SOURCE_LIBELLE[s]}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filtres.recherche}
            onChange={(e) => maj({ recherche: e.target.value })}
            placeholder="Rechercher un client, une référence…"
            aria-label="Rechercher une transaction"
            className="input-boxed w-full rounded-lg border border-transparent bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>

        <Chip
          actif={filtres.sansJustificatif}
          onClick={() => maj({ sansJustificatif: !filtres.sansJustificatif })}
        >
          Sans justificatif{nbSansJustificatif > 0 ? ` (${nbSansJustificatif})` : ""}
        </Chip>
        <Chip
          actif={filtres.avecAnomalie}
          onClick={() => maj({ avecAnomalie: !filtres.avecAnomalie })}
        >
          Avec anomalie{nbAvecAnomalie > 0 ? ` (${nbAvecAnomalie})` : ""}
        </Chip>
      </div>
    </div>
  );
}

export function EtiquetteFiltresActifs({
  filtres,
  nbResultats,
  onReinitialiser,
}: {
  filtres: FiltresTransactions;
  nbResultats: number;
  onReinitialiser: () => void;
}) {
  const actifs =
    filtres.sens !== "tous" ||
    filtres.source !== "toutes" ||
    filtres.sansJustificatif ||
    filtres.avecAnomalie ||
    filtres.recherche.trim() !== "";

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {nbResultats === 1 ? "1 transaction" : `${nbResultats} transactions`}
      </span>
      {actifs && (
        <button
          type="button"
          onClick={onReinitialiser}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <X className="size-3" />
          Réinitialiser les filtres
        </button>
      )}
    </div>
  );
}
