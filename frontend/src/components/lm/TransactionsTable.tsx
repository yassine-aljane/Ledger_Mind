/**
 * Tableau des transactions, ligne dépliable.
 *
 * La ligne repliée répond à « combien, quand, avec qui ». Le dépli répond à « pourquoi
 * c'est classé ainsi » : c'est là que vit `analysis`, l'explication rédigée par l'agent
 * au moment de la capture, jusqu'ici stockée et jamais montrée.
 */

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileWarning,
  Loader2,
  Paperclip,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/finance";
import { fetchCaptureDocumentFile } from "@/lib/api";
import { telechargerFacturePdf } from "@/lib/facturation-api";
import {
  formatDateCourte,
  SOURCE_LIBELLE,
  type TransactionUnifiee,
} from "@/lib/transactions";

const COLONNES_GAUCHE = ["Référence", "Contrepartie", "Date", "Pièce"];
const COLONNES_DROITE = ["HT", "Net", "Statut"];

/**
 * Ouvre la pièce d'origine.
 *
 * L'endpoint `/api/capture/documents/{id}/file` exige l'en-tête d'authentification : un
 * `href` direct renverrait 401. Il faut donc passer par un blob, comme le fait déjà
 * `DocumentInspector`. Une facture émise n'a pas de pièce capturée — son PDF est
 * régénéré par l'API de facturation.
 */
function BoutonJustificatif({ transaction }: { transaction: TransactionUnifiee }) {
  const [etat, setEtat] = useState<"idle" | "chargement" | "erreur">("idle");

  if (!transaction.has_file) {
    return (
      <p className="flex items-center gap-2 text-[0.8125rem] text-warning-ink">
        <FileWarning className="size-3.5 shrink-0" />
        Aucun justificatif attaché — à fournir en cas de contrôle.
      </p>
    );
  }

  const ouvrir = async () => {
    setEtat("chargement");
    try {
      if (transaction.document_id) {
        const blob = await fetchCaptureDocumentFile(transaction.document_id);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        // L'URL objet retient le blob tant qu'elle n'est pas révoquée ; l'onglet a le
        // temps de la lire avant la révocation différée.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else if (transaction.facture_id) {
        await telechargerFacturePdf(transaction.facture_id, transaction.reference);
      }
      setEtat("idle");
    } catch {
      setEtat("erreur");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={ouvrir}
        disabled={etat === "chargement"}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[0.8125rem] font-medium transition-colors hover:border-ink disabled:opacity-60"
      >
        {etat === "chargement" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : transaction.document_id ? (
          <Paperclip className="size-3.5" />
        ) : (
          <Download className="size-3.5" />
        )}
        {transaction.document_id ? "Voir le justificatif" : "Télécharger le PDF"}
      </button>
      {etat === "erreur" && (
        <span className="text-[0.8125rem] text-destructive">Pièce indisponible.</span>
      )}
    </div>
  );
}

function DetailTransaction({ transaction }: { transaction: TransactionUnifiee }) {
  return (
    <div className="space-y-4 border-t border-border bg-secondary/30 px-5 py-5">
      {transaction.analysis ? (
        <div>
          <p className="rule-label-lg mb-2 text-label-ink">Ce que dit l'analyse</p>
          <p className="text-[0.9375rem] leading-relaxed text-pretty">{transaction.analysis}</p>
        </div>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">
          Cette pièce n'a pas encore été analysée.
        </p>
      )}

      {transaction.incoherences.length > 0 && (
        <div>
          <p className="rule-label-lg mb-2 flex items-center gap-2 text-warning-ink">
            <AlertTriangle className="size-3.5" />
            Points à vérifier
          </p>
          <ul className="space-y-1.5">
            {transaction.incoherences.map((message) => (
              <li
                key={message}
                className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[0.8125rem] text-warning-ink"
              >
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-3">
        <div>
          <dt className="rule-label-lg text-label-ink">Type de pièce</dt>
          <dd className="mt-1">{SOURCE_LIBELLE[transaction.source]}</dd>
        </div>
        <div>
          <dt className="rule-label-lg text-label-ink">Catégorie fiscale</dt>
          <dd className="mt-1">{transaction.expense_category ?? "—"}</dd>
        </div>
        <div>
          <dt className="rule-label-lg text-label-ink">Sens</dt>
          <dd className="mt-1">
            {!transaction.est_flux
              ? "Engagement (hors totaux)"
              : transaction.sens === "entrant"
                ? "Entrée"
                : "Sortie"}
          </dd>
        </div>
      </dl>

      <BoutonJustificatif transaction={transaction} />
    </div>
  );
}

function LigneTransaction({ transaction }: { transaction: TransactionUnifiee }) {
  const [ouvert, setOuvert] = useState(false);
  const signe = !transaction.est_flux ? "" : transaction.sens === "entrant" ? "+" : "−";

  return (
    <>
      <tr
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className={cn(
          "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-secondary/40",
          ouvert && "bg-secondary/40",
        )}
      >
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                ouvert && "rotate-180",
              )}
            />
            <span className="num text-[0.8125rem] text-muted-foreground">
              {transaction.reference ?? "—"}
            </span>
            {!transaction.has_file && (
              <FileWarning
                className="size-3.5 shrink-0 text-warning-ink"
                aria-label="Sans justificatif"
              />
            )}
            {transaction.incoherences.length > 0 && (
              <AlertTriangle
                className="size-3.5 shrink-0 text-warning-ink"
                aria-label="Anomalie relevée"
              />
            )}
          </div>
        </td>
        <td className="px-5 py-4">
          <p className="truncate">{transaction.contrepartie ?? transaction.libelle}</p>
          {transaction.contrepartie && (
            <p className="truncate text-[0.8125rem] text-muted-foreground">{transaction.libelle}</p>
          )}
        </td>
        <td className="px-5 py-4 text-muted-foreground">{formatDateCourte(transaction.date)}</td>
        <td className="px-5 py-4">
          <span className="text-[0.8125rem] text-muted-foreground">
            {SOURCE_LIBELLE[transaction.source]}
          </span>
        </td>
        <td className="num px-5 py-4 text-right text-muted-foreground">
          {formatEuros(transaction.montant_ht)}
        </td>
        <td
          className={cn(
            "num px-5 py-4 text-right",
            transaction.est_flux && transaction.sens === "entrant" && "text-success-ink",
          )}
        >
          {transaction.montant_net === null
            ? "—"
            : `${signe}${formatEuros(Math.abs(transaction.montant_net))}`}
        </td>
        <td className="px-5 py-4">
          <div className="flex justify-end">
            <Badge variant={transaction.statut.ton}>{transaction.statut.libelle}</Badge>
          </div>
        </td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={7} className="p-0">
            <DetailTransaction transaction={transaction} />
          </td>
        </tr>
      )}
    </>
  );
}

export function TransactionsTable({
  transactions,
  chargement,
}: {
  transactions: TransactionUnifiee[];
  chargement: boolean;
}) {
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-[0.9375rem]">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              {COLONNES_GAUCHE.map((h) => (
                <th key={h} className="rule-label-lg px-5 py-3.5 text-left text-label-ink">
                  {h}
                </th>
              ))}
              {COLONNES_DROITE.map((h) => (
                <th key={h} className="rule-label-lg px-5 py-3.5 text-right text-label-ink">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chargement
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                      <td key={c} className="px-5 py-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : transactions.map((t) => <LigneTransaction key={t.id} transaction={t} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
