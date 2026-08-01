import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PremiumGate } from "@/components/lm/PremiumPagePlaceholder";
import {
  ArrowLeftRight,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAuthed } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { DocumentChatDrawer } from "@/components/lm/DocumentChatDrawer";
import {
  analyzeCapture,
  answerCapture,
  fetchCaptureInvoices,
  fetchCaptureVirements,
  formatMoney,
  type CaptureAnalyzeResult,
  type CaptureInvoiceItem,
  type CaptureVirementItem,
} from "@/lib/api";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Documents — LedgerMind" },
      { name: "description", content: "Déposez vos factures, relevés et justificatifs." },
      { property: "og:title", content: "Documents — LedgerMind" },
      { property: "og:description", content: "Déposez vos factures, relevés et justificatifs." },
    ],
  }),
  component: CaptureRoute,
});

function CaptureRoute() {
  return (
    <PremiumGate kind="capture">
      <CapturePage />
    </PremiumGate>
  );
}

const PIPELINE = ["OCR", "Extraction", "Classification", "Vérifications", "Sauvegarde"];

function pipelineStep(status: CaptureAnalyzeResult["status"] | null, idx: number): boolean {
  if (!status) return false;
  if (status === "erreur") return idx === 0;
  if (status === "en_attente_utilisateur") return idx < 3;
  return true;
}

// -------- Fusion facture/virement pour un affichage unifié --------
type DocKind = "facture" | "virement";

type UnifiedDoc = {
  document_id: string;
  kind: DocKind;
  label: string;
  subtitle: string;
  amount: number | null;
  currency: string | null;
  amount_eur: number | null;
  created_at: string | null;
};

function unifyDocs(invoices: CaptureInvoiceItem[], virements: CaptureVirementItem[]): UnifiedDoc[] {
  const fromInvoices: UnifiedDoc[] = invoices.map((inv) => ({
    document_id: inv.document_id,
    kind: "facture",
    label: inv.invoice.issuer_name ?? "Facture",
    subtitle: `${inv.expense_category ?? "—"} · ${inv.invoice.issue_date ?? "date inconnue"}`,
    amount: inv.invoice.total_ttc,
    currency: inv.invoice.currency,
    amount_eur: inv.invoice.amount_eur ?? null,
    created_at: inv.created_at ?? null,
  }));
  const fromVirements: UnifiedDoc[] = virements.map((v) => ({
    document_id: v.document_id,
    kind: "virement",
    label:
      v.transfer.direction === "emis"
        ? (v.transfer.beneficiary_name ?? "Virement émis")
        : (v.transfer.sender_name ?? "Virement reçu"),
    subtitle: `${v.transfer.direction === "emis" ? "Émis" : "Reçu"} · ${v.transfer.execution_date ?? "date inconnue"}`,
    amount: v.transfer.amount,
    currency: v.transfer.currency,
    amount_eur: v.transfer.amount_eur ?? null,
    created_at: v.created_at ?? null,
  }));
  return [...fromInvoices, ...fromVirements].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="rule-label mb-1 text-muted-foreground">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

/**
 * Montant dans sa devise d'origine, suivi de son équivalent euro quand la devise n'est pas
 * l'euro (conversion serveur au taux BCE du jour de la pièce — voir backend fx.py).
 */
function EurAmount({
  amount,
  currency,
  amountEur,
}: {
  amount: number | null | undefined;
  currency?: string | null;
  amountEur?: number | null;
}) {
  if (amount == null) return <span className="num">—</span>;
  const cur = currency ?? "EUR";
  return (
    <span className="num">
      {formatMoney(amount)} {cur}
      {amountEur != null && cur !== "EUR" && (
        <span className="ml-2 text-sm text-muted-foreground">≈ {formatMoney(amountEur)} €</span>
      )}
    </span>
  );
}

/** Déclencheur du panneau de discussion propre à un document. */
function ChatDocButton({
  onClick,
  size = "md",
}: {
  onClick: () => void;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-all duration-200 hover:border-ink hover:text-foreground active:scale-95",
        size === "sm" ? "size-7" : "size-8",
      )}
      title="Poser une question sur ce document"
      aria-label="Poser une question sur ce document"
    >
      <MessageSquare className={size === "sm" ? "size-3" : "size-3.5"} />
    </button>
  );
}

function CapturePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptureAnalyzeResult | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [hitlAnswer, setHitlAnswer] = useState("");
  const [invoices, setInvoices] = useState<CaptureInvoiceItem[]>([]);
  const [virements, setVirements] = useState<CaptureVirementItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatDoc, setChatDoc] = useState<{ id: string; label: string } | null>(null);

  async function reloadLists() {
    const [inv, vir] = await Promise.all([fetchCaptureInvoices(), fetchCaptureVirements()]);
    setInvoices(inv);
    setVirements(vir);
  }

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    reloadLists().catch(() => {});
  }, [navigate]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeCapture(file);
      setResult(res);
      setThreadId(res.thread_id);
      if (res.document_id) setSelectedId(res.document_id);
      if (res.status === "completed") await reloadLists();
      if (res.status === "erreur") {
        setError(res.error || "Erreur lors de l'analyse.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setLoading(false);
    }
  }

  async function handleHitlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!threadId || !hitlAnswer.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await answerCapture(threadId, hitlAnswer.trim());
      if (res.analyze) {
        setResult(res.analyze);
        if (res.analyze.document_id) setSelectedId(res.analyze.document_id);
        if (res.analyze.status === "completed") await reloadLists();
        if (res.analyze.status === "erreur") {
          setError(res.analyze.error || res.error || "Erreur.");
        }
      }
      setHitlAnswer("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setLoading(false);
    }
  }

  const unified = unifyDocs(invoices, virements);
  const activeDoc = unified.find((d) => d.document_id === selectedId);
  const activeInvoice = invoices.find((i) => i.document_id === selectedId);
  const activeVirement = virements.find((v) => v.document_id === selectedId);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Documents"
        title={
          <>
            Déposez, on <span className="italic font-normal">s'occupe du reste.</span>
          </>
        }
        description="PDF ou image — l'agent capture extrait, qualifie et classe chaque facture ou virement automatiquement."
      />

      <div className="grid lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-7 space-y-6">
          <label className="animate-rise block cursor-pointer rounded-2xl border border-dashed border-border bg-card p-14 text-center transition-all duration-200 hover:border-accent hover:bg-accent/5">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls"
              className="sr-only"
              disabled={loading}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent-ink">
              <UploadCloud className="size-5" />
            </div>
            <p className="text-base font-medium">
              {loading ? "Analyse en cours…" : "Glissez une facture ou un virement ici"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              PDF, image · facture ou justificatif de virement · détection automatique · 20 Mo max
            </p>
          </label>

          {loading && (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">
                OCR, extraction et classification… Cela peut prendre 30 à 90 secondes.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/8 p-5 text-sm font-medium text-destructive"
            >
              {error}
            </div>
          )}

          {result && (
            <section className="animate-rise space-y-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg">Résultat d&apos;analyse</h2>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      result.status === "completed"
                        ? "success"
                        : result.status === "en_attente_utilisateur"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {result.status === "completed"
                      ? "Terminé"
                      : result.status === "en_attente_utilisateur"
                        ? "Info requise"
                        : "Erreur"}
                  </Badge>
                  {result.status === "completed" && result.document_id && (
                    <ChatDocButton
                      onClick={() =>
                        setChatDoc({
                          id: result.document_id!,
                          label:
                            result.document_type === "virement"
                              ? (result.transfer?.beneficiary_name ??
                                result.transfer?.sender_name ??
                                "Virement")
                              : (result.invoice?.issuer_name ?? "Facture"),
                        })
                      }
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {PIPELINE.map((step, i) => (
                  <div key={step} className="space-y-2">
                    <div
                      className={cn(
                        "h-1.5 rounded-full transition-colors",
                        pipelineStep(result.status, i) ? "bg-success" : "bg-border",
                      )}
                    />
                    <span className="rule-label block text-muted-foreground">{step}</span>
                  </div>
                ))}
              </div>

              {result.status === "en_attente_utilisateur" && result.pending && (
                <form onSubmit={handleHitlSubmit} className="space-y-4 border-t border-border pt-6">
                  <p className="text-sm font-medium">{result.pending.question}</p>
                  {result.pending.suggestions && result.pending.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {result.pending.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setHitlAnswer(s)}
                          className="suggestion-chip rounded-full px-3 py-1.5 text-xs font-medium"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={hitlAnswer}
                    onChange={(e) => setHitlAnswer(e.target.value)}
                    placeholder="Votre réponse…"
                    className="input-boxed w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm focus:border-ink focus:outline-none"
                  />
                  <Button type="submit" disabled={!hitlAnswer.trim() || loading}>
                    <Send /> Envoyer
                  </Button>
                </form>
              )}

              {result.status === "completed" && result.document_type === "virement" && result.transfer && (
                <div className="space-y-4 border-t border-border pt-6">
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <Field label="Référence">
                      <span className="num">{result.transfer.transfer_reference ?? "—"}</span>
                    </Field>
                    <Field label="Date d'exécution">{result.transfer.execution_date ?? "—"}</Field>
                    <Field label="Montant">
                      <EurAmount
                        amount={result.transfer.amount}
                        currency={result.transfer.currency}
                        amountEur={result.transfer.amount_eur}
                      />
                    </Field>
                    <Field label="Sens">
                      {result.transfer.direction === "emis" ? "Émis" : result.transfer.direction === "recu" ? "Reçu" : "—"}
                    </Field>
                    <Field label="Émetteur">{result.transfer.sender_name ?? "—"}</Field>
                    <Field label="Bénéficiaire">{result.transfer.beneficiary_name ?? "—"}</Field>
                    <Field label="IBAN émetteur">
                      <span
                        className={`num text-xs break-all ${
                          result.incoherences?.some((i) => i.includes(result.transfer!.sender_iban ?? "\0"))
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {result.transfer.sender_iban ?? "—"}
                      </span>
                    </Field>
                    <Field label="IBAN bénéficiaire">
                      <span
                        className={`num text-xs break-all ${
                          result.incoherences?.some((i) => i.includes(result.transfer!.beneficiary_iban ?? "\0"))
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {result.transfer.beneficiary_iban ?? "—"}
                      </span>
                    </Field>
                    <Field label="BIC">
                      <span className="num text-xs">{result.transfer.beneficiary_bic ?? "—"}</span>
                    </Field>
                    <Field label="Banque">{result.transfer.bank_name ?? "—"}</Field>
                    <Field label="Type">{result.transfer.transfer_type ?? "—"}</Field>
                    {result.transfer.motif && <Field label="Motif">{result.transfer.motif}</Field>}
                  </div>

                  {result.analysis && (
                    <div>
                      <p className="rule-label mb-2 text-muted-foreground">Analyse</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{result.analysis}</p>
                    </div>
                  )}

                  {result.incoherences && result.incoherences.length > 0 && (
                    <ul className="space-y-2">
                      {result.incoherences.map((inc, i) => (
                        <li key={i} className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
                          {inc}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {result.status === "completed" && result.document_type !== "virement" && result.invoice && (
                <div className="space-y-4 border-t border-border pt-6">
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <Field label="Émetteur">{result.invoice.issuer_name ?? "—"}</Field>
                    <Field label="Client">{result.invoice.client_name ?? "—"}</Field>
                    <Field label="N° facture">
                      <span className="num">{result.invoice.invoice_number ?? "—"}</span>
                    </Field>
                    <Field label="Date d'émission">{result.invoice.issue_date ?? "—"}</Field>
                    <Field label="Sous-total HT">
                      <span className="num">
                        {result.invoice.subtotal_ht != null ? `${formatMoney(result.invoice.subtotal_ht)} ${result.invoice.currency ?? "€"}` : "—"}
                      </span>
                    </Field>
                    <Field label="TVA">
                      <span className="num">
                        {result.invoice.vat_amount != null ? `${formatMoney(result.invoice.vat_amount)} ${result.invoice.currency ?? "€"}` : "—"}
                      </span>
                    </Field>
                    <Field label="Total TTC">
                      <span className="text-lg">
                        <EurAmount
                          amount={result.invoice.total_ttc}
                          currency={result.invoice.currency}
                          amountEur={result.invoice.amount_eur}
                        />
                      </span>
                    </Field>
                    <Field label="Catégorie">
                      <span className="capitalize">{result.expense_category ?? "—"}</span>
                    </Field>
                    <Field label="Échéance">
                      {result.invoice.due_date ?? (result.invoice.payment_terms_days ? `${result.invoice.payment_terms_days} jours` : "—")}
                    </Field>
                    <Field label="Statut de paiement">
                      {result.paid === true ? "Réglée" : result.paid === false ? "Non réglée" : "—"}
                    </Field>
                  </div>

                  {result.invoice.line_items && result.invoice.line_items.length > 0 && (
                    <div>
                      <p className="rule-label mb-2 text-muted-foreground">Lignes de facture</p>
                      <div className="space-y-1.5">
                        {result.invoice.line_items.map((li, i) => (
                          <div key={i} className="flex justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
                            <span className="text-muted-foreground">
                              {li.description ?? "—"} {li.quantity != null && `× ${li.quantity}`}
                            </span>
                            <span className="num shrink-0">{li.total != null ? formatMoney(li.total) : "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.analysis && (
                    <div>
                      <p className="rule-label mb-2 text-muted-foreground">Analyse</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{result.analysis}</p>
                    </div>
                  )}

                  {result.incoherences && result.incoherences.length > 0 && (
                    <ul className="space-y-2">
                      {result.incoherences.map((inc, i) => (
                        <li key={i} className="rounded-lg border border-warning/40 bg-warning/12 px-4 py-2 text-sm text-warning-ink">
                          {inc}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="space-y-5 lg:sticky lg:top-24 lg:col-span-5">
          <h2 className="rule-label text-accent-ink">Mes documents</h2>
          {unified.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Aucun document analysé.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Factures et virements vivent dans une seule liste, triée par date d'ajout : du
                  point de vue de l'utilisateur, ce sont « ses documents », pas deux registres. */}
              {unified.map((doc) => (
                <div
                  key={doc.document_id}
                  className={cn(
                    "card-hover w-full space-y-1 rounded-2xl border bg-card p-4 shadow-soft transition-all duration-200",
                    selectedId === doc.document_id
                      ? "border-accent ring-1 ring-accent/40"
                      : "border-border",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(doc.document_id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant={doc.kind === "virement" ? "info" : "success"}>
                          {doc.kind === "virement" ? (
                            <ArrowLeftRight />
                          ) : (
                            <FileText />
                          )}
                          {doc.kind === "virement" ? "Virement" : "Facture"}
                        </Badge>
                        <span className="truncate text-sm font-medium">{doc.label}</span>
                      </span>
                      <span className="num shrink-0 text-right text-xs text-muted-foreground">
                        {doc.amount != null
                          ? `${formatMoney(doc.amount)} ${doc.currency ?? "€"}`
                          : "—"}
                        {doc.amount_eur != null && doc.currency !== "EUR" && (
                          <span className="block text-muted-foreground/70">
                            ≈ {formatMoney(doc.amount_eur)} €
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{doc.subtitle}</p>
                  </button>
                  <div className="flex justify-end pt-1">
                    <ChatDocButton
                      size="sm"
                      onClick={() => setChatDoc({ id: doc.document_id, label: doc.label })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeDoc && !result && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="rule-label mb-2 text-muted-foreground">Synthèse</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {(activeInvoice?.analysis ?? activeVirement?.analysis) || "—"}
              </p>
            </div>
          )}
        </div>
      </div>

      {chatDoc && (
        <DocumentChatDrawer
          documentId={chatDoc.id}
          label={chatDoc.label}
          onClose={() => setChatDoc(null)}
        />
      )}
    </AppShell>
  );
}
