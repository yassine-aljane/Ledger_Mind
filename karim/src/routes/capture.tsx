import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Money,
  Spinner,
  formatDate,
} from "@/components/ui-kit";
import { UploadCard } from "@/components/orchestrator";
import { api, ApiError } from "@/lib/api";
import { DEMO_INVOICE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type {
  BankTransfer,
  CapturePending,
  CaptureResult,
  Invoice,
  InvoiceListItem,
  VirementListItem,
} from "@/lib/types";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Capture de documents — LedgerMind" },
      {
        name: "description",
        content:
          "Analysez factures et virements : lignes détaillées, TVA, échéances, doublons et incohérences détectés automatiquement.",
      },
      { property: "og:title", content: "Capture de documents — LedgerMind" },
      { property: "og:description", content: "Vos factures lues ligne à ligne." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="capture"
      title="Capture intelligente"
      pitch="Déposez une facture : LedgerMind en extrait chaque ligne et signale ce qui cloche."
      benefits={[
        "Lignes, TVA, échéances et catégorie de charge extraites",
        "Doublons détectés avant enregistrement",
        "Incohérences fiscales signalées (TVA facturée à tort, etc.)",
        "Posez vos questions directement sur un document",
      ]}
      preview={<InvoicePreview invoice={DEMO_INVOICE} />}
    >
      <Capture />
    </PremiumGate>
  );
}

type ChatTurn = {
  id: string;
  role: "assistant" | "user";
  content: string;
  suggestions?: string[];
};

function Capture() {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api.invoices(), retry: false });
  const virements = useQuery({ queryKey: ["virements"], queryFn: () => api.virements(), retry: false });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  function pushAssistant(content: string, suggestions?: string[]) {
    setTurns((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}-${prev.length}`,
        role: "assistant",
        content,
        suggestions,
      },
    ]);
  }

  function pushUser(content: string) {
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}-${prev.length}`, role: "user", content },
    ]);
  }

  function applyResult(res: CaptureResult, opts?: { skipPendingPrompt?: boolean }) {
    setResult(res);
    if (res.status === "erreur") {
      pushAssistant(res.error || "Document illisible.");
      return;
    }
    if (res.status === "en_attente_utilisateur" && res.pending && !opts?.skipPendingPrompt) {
      const q =
        res.pending.question ||
        (res.pending.type === "doublon"
          ? "Cette facture ressemble à un doublon. Dois-je l'enregistrer quand même ?"
          : "Une précision est nécessaire pour continuer.");
      pushAssistant(q, res.pending.suggestions ?? undefined);
      return;
    }
    if (res.status === "completed") {
      const kind = res.document_type === "virement" ? "virement" : "facture";
      pushAssistant(
        `Analyse terminée. Votre ${kind} est prête à gauche — posez-moi une question sur ce document si besoin.`,
      );
    }
  }

  async function analyze(file: File) {
    setBusy(true);
    setTurns([]);
    setResult(null);
    setDraft("");
    try {
      pushAssistant(`Document reçu : « ${file.name} ». Lecture OCR et extraction en cours…`);
      const res = await api.captureAnalyze(file);
      applyResult(res);
      void invoices.refetch();
      void virements.refetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Analyse impossible.";
      toast.error(msg);
      pushAssistant(msg);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    pushUser(text);
    setDraft("");
    setBusy(true);

    try {
      if (result?.status === "en_attente_utilisateur" && result.thread_id) {
        const res = await api.captureAnswer({ thread_id: result.thread_id, answer: text });
        applyResult(res);
        if (res.status === "completed") {
          void invoices.refetch();
          void virements.refetch();
        }
        return;
      }

      const docId = result?.document_id;
      if (!docId) {
        pushAssistant("Déposez d'abord un document pour que je puisse répondre.");
        return;
      }

      const res = await api.captureQa({ document_id: docId, question: text });
      pushAssistant(res.answer ?? res.error ?? "Pas de réponse.");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Envoi impossible.";
      toast.error(msg);
      pushAssistant(msg);
    } finally {
      setBusy(false);
    }
  }

  const awaitingHitl = result?.status === "en_attente_utilisateur";
  const chatReady = Boolean(result?.document_id) || awaitingHitl || turns.length > 0;
  const placeholder = awaitingHitl
    ? "Répondez à la question…"
    : result?.document_id
      ? "Ex. cette TVA est-elle correcte ?"
      : "Déposez un document pour démarrer la conversation…";

  return (
    <AppShell>
      <PageHeader
        eyebrow="Premium"
        title="Capture de documents"
        description="Factures, avoirs, virements : déposez, LedgerMind structure et contrôle."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* -------- Colonne gauche : upload + champs extraits -------- */}
        <div className="space-y-6">
          <UploadCard
            title="Déposer un document"
            description="PDF ou image d'une facture, d'un avoir ou d'un avis de virement."
            busy={busy && !result}
            onFile={analyze}
          />

          {busy && !result && <LoadingBlock label="Lecture du document…" />}

          {result?.status === "erreur" && (
            <ErrorBlock message={result.error || "Document illisible."} />
          )}

          {result?.status === "en_attente_utilisateur" && result.pending?.type === "doublon" && (
            <DuplicateCompare pending={result.pending} />
          )}

          {/* Afficher tous les champs dès qu'on a une facture (complété ou en attente) */}
          {(result?.status === "completed" || result?.status === "en_attente_utilisateur") &&
            (result.invoice || result.pending?.new_invoice) && (
              <ExtractedInvoice
                invoice={(result.invoice || result.pending?.new_invoice)!}
                expenseCategory={result.expense_category}
                analysis={result.analysis}
                incoherences={result.incoherences ?? result.invoice?.incoherences}
                paid={result.paid ?? result.invoice?.paid}
                paymentDate={result.payment_date ?? result.invoice?.payment_date}
                paymentDaysUntil={result.payment_days_until ?? result.invoice?.payment_days_until}
                saved={result.saved}
                duplicateSkipped={result.duplicate_skipped}
              />
            )}

          {result?.status === "completed" && result.transfer && (
            <ExtractedTransfer
              transfer={result.transfer}
              analysis={result.analysis}
              incoherences={result.incoherences}
            />
          )}

          <HistoryLists
            invoices={invoices.data}
            virements={virements.data}
            invoicesLoading={invoices.isLoading}
            virementsLoading={virements.isLoading}
            invoicesError={invoices.isError}
            onRetryInvoices={() => void invoices.refetch()}
            onSelectInvoice={(row) => {
              setResult({
                status: "completed",
                document_id: row.document_id,
                document_type: "facture",
                invoice: row.invoice,
                expense_category: row.expense_category,
                analysis: row.analysis,
                incoherences: row.incoherences,
                paid: row.paid,
                payment_date: row.payment_date,
                payment_days_until: row.payment_days_until,
              });
              setTurns([
                {
                  id: `sel-${row.document_id}`,
                  role: "assistant",
                  content:
                    "Facture sélectionnée. Posez-moi une question sur ce document (déductibilité, TVA, échéance…).",
                },
              ]);
            }}
            onSelectVirement={(row) => {
              setResult({
                status: "completed",
                document_id: row.document_id,
                document_type: "virement",
                transfer: row.transfer,
                analysis: row.analysis,
                incoherences: row.incoherences,
              });
              setTurns([
                {
                  id: `sel-${row.document_id}`,
                  role: "assistant",
                  content: "Virement sélectionné. Posez-moi une question sur ce document.",
                },
              ]);
            }}
          />
        </div>

        {/* -------- Colonne droite : conversation -------- */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card className="flex h-[min(70vh,720px)] flex-col overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <p className="rule-label text-muted-foreground">Assistant document</p>
              <h2 className="mt-1 text-lg font-semibold">Conversation</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Validation et questions sur le document — fil continu à droite.
              </p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {!chatReady && (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  Déposez un document pour démarrer la conversation.
                </p>
              )}
              {turns.map((t) => (
                <div
                  key={t.id}
                  className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      t.role === "user"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md border border-border bg-secondary/50 text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{t.content}</p>
                    {!!t.suggestions?.length && t.role === "assistant" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={busy}
                            onClick={() => void sendMessage(s)}
                            className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-accent disabled:opacity-50"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" /> LedgerMind répond…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              className="border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage(draft);
              }}
            >
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy || (!awaitingHitl && !result?.document_id)}
                  placeholder={placeholder}
                  aria-label="Message"
                />
                <Button
                  type="submit"
                  variant="safran"
                  size="icon"
                  disabled={busy || !draft.trim() || (!awaitingHitl && !result?.document_id)}
                  aria-label="Envoyer"
                >
                  {busy ? <Spinner /> : <Send />}
                </Button>
              </div>
            </form>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Affichage complet des champs extraits                                      */
/* -------------------------------------------------------------------------- */

const INVOICE_EXCLUDE = new Set([
  "invoice_number",
  "issuer_name",
  "issuer_tax_id",
  "client_name",
  "issue_date",
  "due_date",
  "payment_terms_days",
  "subtotal_ht",
  "vat_amount",
  "total_ttc",
  "currency",
  "line_items",
  "incoherences",
  "saved",
  "duplicate_skipped",
  "paid",
  "payment_date",
  "payment_days_until",
  "expense_category",
]);

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div>
      <p className="rule-label mb-1 text-muted-foreground">{label}</p>
      <p className={cn("break-words text-sm font-medium", mono && "font-mono")}>
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function money(n: number | null | undefined, currency?: string | null) {
  if (n == null) return null;
  return <Money value={n} currency={currency} />;
}

function RemainingFields({
  data,
  exclude,
}: {
  data: Record<string, unknown>;
  exclude: Set<string>;
}) {
  const entries = Object.entries(data).filter(([k, v]) => {
    if (exclude.has(k)) return false;
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === "object" && !Array.isArray(v)) return false;
    return true;
  });
  if (!entries.length) return null;
  return (
    <div>
      <p className="rule-label mb-3 text-muted-foreground">Autres champs extraits</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <Field
            key={k}
            label={k.replace(/_/g, " ")}
            value={typeof v === "boolean" ? (v ? "Oui" : "Non") : String(v)}
            mono={typeof v === "number" || /id|iban|bic|number|date|siren|siret/i.test(k)}
          />
        ))}
      </div>
    </div>
  );
}

function ExtractedInvoice({
  invoice,
  expenseCategory,
  analysis,
  incoherences,
  paid,
  paymentDate,
  paymentDaysUntil,
  saved,
  duplicateSkipped,
}: {
  invoice: Invoice;
  expenseCategory?: string | null;
  analysis?: string | Record<string, unknown> | null;
  incoherences?: string[] | null;
  paid?: boolean | null;
  paymentDate?: string | null;
  paymentDaysUntil?: number | null;
  saved?: boolean | null;
  duplicateSkipped?: boolean | null;
}) {
  const lines = invoice.line_items ?? [];
  const paidLabel =
    paid === true ? "Oui" : paid === false ? "Non" : null;
  const analysisText =
    typeof analysis === "string"
      ? analysis
      : analysis && typeof analysis === "object"
        ? JSON.stringify(analysis, null, 2)
        : null;

  return (
    <Card className="animate-rise space-y-8 overflow-hidden p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="rule-label text-accent-foreground">Champs extraits</p>
          <h2 className="mt-2 text-2xl">{invoice.invoice_number || "Facture"}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {paid !== undefined && paid !== null && (
            <Badge tone={paid ? "success" : "warning"}>{paid ? "Payée" : "En attente"}</Badge>
          )}
          {saved && <Badge tone="info">Enregistrée</Badge>}
          {duplicateSkipped && <Badge tone="warning">Doublon ignoré</Badge>}
          {expenseCategory && <Badge tone="neutral">{expenseCategory}</Badge>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Émetteur" value={invoice.issuer_name} />
        <Field label="N° facture" value={invoice.invoice_number} mono />
        <Field label="Matricule fiscal / SIREN" value={invoice.issuer_tax_id} mono />
        <Field label="Client" value={invoice.client_name} />
        <Field label="Date d'émission" value={formatDate(invoice.issue_date)} mono />
        <Field label="Échéance" value={formatDate(invoice.due_date)} mono />
        <Field
          label="Délai de paiement"
          value={
            invoice.payment_terms_days != null ? `${invoice.payment_terms_days} jours` : null
          }
        />
        <Field label="Catégorie de dépense" value={expenseCategory || invoice.expense_category} />
        <Field label="Sous-total HT" value={money(invoice.subtotal_ht, invoice.currency)} mono />
        <Field label="TVA" value={money(invoice.vat_amount, invoice.currency)} mono />
        <Field label="Total TTC" value={money(invoice.total_ttc, invoice.currency)} mono />
        <Field label="Devise" value={invoice.currency} mono />
      </div>

      <div className="rounded-2xl border border-border bg-secondary/40 p-5">
        <p className="rule-label mb-4 text-muted-foreground">Paiement</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Payée" value={paidLabel} />
          <Field label="Date d'échéance / paiement" value={formatDate(paymentDate)} mono />
          <Field
            label="Jours restants"
            value={paymentDaysUntil != null ? String(paymentDaysUntil) : null}
            mono
          />
        </div>
      </div>

      {lines.length > 0 && (
        <div>
          <p className="rule-label mb-3 text-muted-foreground">
            Lignes de facture ({lines.length})
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 text-right font-semibold">Qté</th>
                  <th className="px-4 py-3 text-right font-semibold">P.U.</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((li, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">{li.description ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {li.quantity ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {li.unit_price != null ? (
                        <Money value={li.unit_price} currency={invoice.currency} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {li.total != null ? (
                        <Money value={li.total} currency={invoice.currency} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RemainingFields data={invoice as Record<string, unknown>} exclude={INVOICE_EXCLUDE} />

      {analysisText && (
        <div>
          <p className="rule-label mb-2 text-muted-foreground">Analyse comptable</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {analysisText}
          </p>
        </div>
      )}

      {!!incoherences?.length && (
        <div>
          <p className="rule-label mb-3 text-warning-foreground">Incohérences détectées</p>
          <ul className="space-y-2">
            {incoherences.map((inc, i) => (
              <li
                key={i}
                className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
              >
                {inc}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const TRANSFER_KNOWN = [
  "transfer_reference",
  "execution_date",
  "value_date",
  "amount",
  "currency",
  "direction",
  "sender_name",
  "receiver_name",
  "beneficiary_name",
  "sender_iban",
  "receiver_iban",
  "beneficiary_iban",
  "bic",
  "beneficiary_bic",
  "bank_name",
  "motif",
  "transfer_type",
] as const;

function ExtractedTransfer({
  transfer,
  analysis,
  incoherences,
}: {
  transfer: BankTransfer;
  analysis?: string | Record<string, unknown> | null;
  incoherences?: string[] | null;
}) {
  const analysisText =
    typeof analysis === "string"
      ? analysis
      : analysis && typeof analysis === "object"
        ? JSON.stringify(analysis, null, 2)
        : null;
  const known = new Set<string>(TRANSFER_KNOWN);

  return (
    <Card className="animate-rise space-y-8 p-6 sm:p-8">
      <div>
        <p className="rule-label text-accent-foreground">Champs extraits</p>
        <h2 className="mt-2 text-2xl">{transfer.transfer_reference || "Virement"}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Référence" value={transfer.transfer_reference} mono />
        <Field label="Direction" value={transfer.direction} />
        <Field label="Montant" value={money(transfer.amount, transfer.currency)} mono />
        <Field label="Devise" value={transfer.currency} mono />
        <Field label="Date d'exécution" value={formatDate(transfer.execution_date)} mono />
        <Field label="Date de valeur" value={formatDate(transfer.value_date)} mono />
        <Field label="Émetteur" value={transfer.sender_name} />
        <Field label="IBAN émetteur" value={transfer.sender_iban} mono />
        <Field
          label="Bénéficiaire"
          value={transfer.beneficiary_name || transfer.receiver_name}
        />
        <Field
          label="IBAN bénéficiaire"
          value={transfer.beneficiary_iban || transfer.receiver_iban}
          mono
        />
        <Field label="BIC" value={transfer.bic || transfer.beneficiary_bic} mono />
        <Field label="Banque" value={transfer.bank_name} />
        <Field label="Type" value={transfer.transfer_type} />
        <Field label="Motif" value={transfer.motif} />
      </div>

      <RemainingFields data={transfer as Record<string, unknown>} exclude={known} />

      {analysisText && (
        <div>
          <p className="rule-label mb-2 text-muted-foreground">Analyse</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {analysisText}
          </p>
        </div>
      )}

      {!!incoherences?.length && (
        <ul className="space-y-2">
          {incoherences.map((inc, i) => (
            <li
              key={i}
              className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              {inc}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DuplicateCompare({ pending }: { pending: CapturePending }) {
  return (
    <Card className="p-6">
      <Badge tone="warning">Doublon possible</Badge>
      <p className="mt-3 text-sm text-muted-foreground">
        Comparez les deux documents, puis répondez dans la conversation à droite.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {pending.existing_invoice && (
          <MiniInvoice title="Facture existante" invoice={pending.existing_invoice} />
        )}
        {pending.new_invoice && (
          <MiniInvoice title="Nouveau document" invoice={pending.new_invoice} />
        )}
      </div>
    </Card>
  );
}

function MiniInvoice({ title, invoice }: { title: string; invoice: Invoice }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
      <p className="rule-label text-muted-foreground">{title}</p>
      <p className="mt-2 font-semibold">{invoice.issuer_name || "—"}</p>
      <p className="font-mono text-xs text-muted-foreground">{invoice.invoice_number || "—"}</p>
      <p className="mt-1 font-mono text-xs">
        {invoice.total_ttc != null ? (
          <Money value={invoice.total_ttc} currency={invoice.currency} />
        ) : (
          "—"
        )}
      </p>
    </div>
  );
}

function HistoryLists({
  invoices,
  virements,
  invoicesLoading,
  virementsLoading,
  invoicesError,
  onRetryInvoices,
  onSelectInvoice,
  onSelectVirement,
}: {
  invoices?: InvoiceListItem[];
  virements?: VirementListItem[];
  invoicesLoading: boolean;
  virementsLoading: boolean;
  invoicesError: boolean;
  onRetryInvoices: () => void;
  onSelectInvoice: (row: InvoiceListItem) => void;
  onSelectVirement: (row: VirementListItem) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-lg">Factures enregistrées</h2>
        {invoicesLoading && <LoadingBlock />}
        {invoicesError && (
          <ErrorBlock message="Liste indisponible." onRetry={onRetryInvoices} />
        )}
        {invoices?.length === 0 && (
          <EmptyState title="Aucune facture" description="Déposez votre premier document." />
        )}
        <ul className="mt-3 space-y-2">
          {invoices?.map((row) => {
            const inv = row.invoice;
            return (
              <li key={row.document_id}>
                <button
                  type="button"
                  onClick={() => onSelectInvoice(row)}
                  className="w-full rounded-xl border border-border p-3 text-left text-sm transition-colors hover:border-accent"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{inv.invoice_number || "Sans numéro"}</span>
                    <Money value={inv.total_ttc} currency={inv.currency} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {inv.client_name || inv.issuer_name} · {formatDate(inv.issue_date)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg">Virements</h2>
        {virementsLoading && <LoadingBlock />}
        {virements?.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Aucun virement.</p>
        )}
        <ul className="mt-3 space-y-2">
          {virements?.map((row) => {
            const v = row.transfer;
            return (
              <li key={row.document_id}>
                <button
                  type="button"
                  onClick={() => onSelectVirement(row)}
                  className="w-full rounded-xl border border-border p-3 text-left text-sm transition-colors hover:border-accent"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{v.transfer_reference || "Virement"}</span>
                    <Money value={v.amount} currency={v.currency} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {v.direction} · {formatDate(v.execution_date)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function InvoicePreview({ invoice }: { invoice: Invoice }) {
  return (
    <Card className="p-6">
      <p className="rule-label text-muted-foreground">Aperçu</p>
      <h3 className="mt-2 text-xl">{invoice.invoice_number || "Facture"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{invoice.issuer_name}</p>
      <p className="mt-4 font-mono text-lg">
        <Money value={invoice.total_ttc} currency={invoice.currency} />
      </p>
    </Card>
  );
}
