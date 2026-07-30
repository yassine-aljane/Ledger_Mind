import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import { PremiumPagePlaceholder } from "@/components/lm/PremiumPagePlaceholder";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { isAuthed } from "@/lib/auth";
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
  component: CapturePage,
});

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
      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

function EurAmount({
  amount,
  currency,
  amountEur,
}: {
  amount: number | null | undefined;
  currency?: string | null;
  amountEur?: number | null;
}) {
  if (amount == null) return <span className="font-mono">—</span>;
  const cur = currency ?? "EUR";
  return (
    <span className="font-mono">
      {formatMoney(amount)} {cur}
      {amountEur != null && cur !== "EUR" && (
        <span className="ml-2 text-ink/40 text-sm">≈ {formatMoney(amountEur)} €</span>
      )}
    </span>
  );
}

function CapturePage() {
  if (usePlan() === "free") return <PremiumPagePlaceholder kind="capture" />;
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
          <label className="block bg-white border border-dashed border-border hover:border-teal-dark hover:bg-teal-dark/5 transition-all duration-200 rounded-2xl p-16 text-center cursor-pointer">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls"
              className="sr-only"
              disabled={loading}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="mx-auto size-16 rounded-full bg-teal-dark/10 grid place-items-center mb-6">
              <span className="text-3xl text-teal-dark">↑</span>
            </div>
            <p className="font-semibold text-lg">
              {loading ? "Analyse en cours…" : "Glissez une facture ou un virement ici"}
            </p>
            <p className="text-sm text-ink/50 mt-2">
              PDF, image · facture ou justificatif de virement · détection automatique · 20 Mo max
            </p>
          </label>

          {loading && (
            <div className="bg-white border border-border rounded-2xl p-8 text-center">
              <div className="inline-block size-8 border-[3px] border-ink/20 border-t-teal-dark rounded-full animate-spin" />
              <p className="text-sm text-ink/50 mt-4">
                OCR, extraction et classification… Cela peut prendre 30 à 90 secondes.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-coral/10 border border-coral/30 rounded-2xl p-6 text-sm text-coral font-medium">
              {error}
            </div>
          )}

          {result && (
            <section className="bg-white border border-border rounded-2xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Résultat d'analyse</h2>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-mono uppercase tracking-widest ${
                      result.status === "completed"
                        ? "text-teal-dark"
                        : result.status === "en_attente_utilisateur"
                          ? "text-amber-600"
                          : "text-coral"
                    }`}
                  >
                    {result.status === "completed"
                      ? "Terminé"
                      : result.status === "en_attente_utilisateur"
                        ? "Info requise"
                        : "Erreur"}
                  </span>
                  {result.status === "completed" && result.document_id && (
                    <button
                      type="button"
                      onClick={() =>
                        setChatDoc({
                          id: result.document_id!,
                          label:
                            result.document_type === "virement"
                              ? (result.transfer?.beneficiary_name ?? result.transfer?.sender_name ?? "Virement")
                              : (result.invoice?.issuer_name ?? "Facture"),
                        })
                      }
                      className="size-9 rounded-full border border-border hover:border-teal-dark transition-all duration-200 active:scale-[0.95] grid place-items-center text-lg"
                      title="Poser une question sur ce document"
                    >
                      💬
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {PIPELINE.map((step, i) => (
                  <div key={step} className="space-y-2">
                    <div
                      className={`h-1.5 rounded-full ${
                        pipelineStep(result.status, i) ? "bg-teal-light" : "bg-border"
                      }`}
                    />
                    <span className="text-[9px] uppercase tracking-widest text-ink/40 font-semibold">
                      {step}
                    </span>
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
                          className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-ink transition-all duration-200 active:scale-[0.97]"
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
                    className="w-full px-4 py-3 border border-border rounded-xl text-sm input-boxed focus:outline-none focus:border-ink"
                  />
                  <button
                    type="submit"
                    disabled={!hitlAnswer.trim() || loading}
                    className="px-6 py-3 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
                  >
                    Envoyer
                  </button>
                </form>
              )}

              {result.status === "completed" && result.document_type === "virement" && result.transfer && (
                <div className="space-y-4 border-t border-border pt-6">
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <Field label="Référence">
                      <span className="font-mono">{result.transfer.transfer_reference ?? "—"}</span>
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
                        className={`font-mono text-xs break-all ${
                          result.incoherences?.some((i) => i.includes(result.transfer!.sender_iban ?? "\0"))
                            ? "text-coral"
                            : ""
                        }`}
                      >
                        {result.transfer.sender_iban ?? "—"}
                      </span>
                    </Field>
                    <Field label="IBAN bénéficiaire">
                      <span
                        className={`font-mono text-xs break-all ${
                          result.incoherences?.some((i) => i.includes(result.transfer!.beneficiary_iban ?? "\0"))
                            ? "text-coral"
                            : ""
                        }`}
                      >
                        {result.transfer.beneficiary_iban ?? "—"}
                      </span>
                    </Field>
                    <Field label="BIC">
                      <span className="font-mono text-xs">{result.transfer.beneficiary_bic ?? "—"}</span>
                    </Field>
                    <Field label="Banque">{result.transfer.bank_name ?? "—"}</Field>
                    <Field label="Type">{result.transfer.transfer_type ?? "—"}</Field>
                    {result.transfer.motif && <Field label="Motif">{result.transfer.motif}</Field>}
                  </div>

                  {result.analysis && (
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                        Analyse
                      </p>
                      <p className="text-sm text-ink/80 leading-relaxed">{result.analysis}</p>
                    </div>
                  )}

                  {result.incoherences && result.incoherences.length > 0 && (
                    <ul className="space-y-2">
                      {result.incoherences.map((inc, i) => (
                        <li key={i} className="text-sm text-coral bg-coral/10 px-4 py-2 rounded-lg">
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
                      <span className="font-mono">{result.invoice.invoice_number ?? "—"}</span>
                    </Field>
                    <Field label="Date d'émission">{result.invoice.issue_date ?? "—"}</Field>
                    <Field label="Sous-total HT">
                      <span className="font-mono">
                        {result.invoice.subtotal_ht != null ? `${formatMoney(result.invoice.subtotal_ht)} ${result.invoice.currency ?? "€"}` : "—"}
                      </span>
                    </Field>
                    <Field label="TVA">
                      <span className="font-mono">
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
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                        Lignes de facture
                      </p>
                      <div className="space-y-1.5">
                        {result.invoice.line_items.map((li, i) => (
                          <div key={i} className="flex justify-between text-sm bg-background rounded-lg px-3 py-2">
                            <span className="text-ink/70">
                              {li.description ?? "—"} {li.quantity != null && `× ${li.quantity}`}
                            </span>
                            <span className="font-mono">{li.total != null ? formatMoney(li.total) : "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.analysis && (
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                        Analyse
                      </p>
                      <p className="text-sm text-ink/80 leading-relaxed">{result.analysis}</p>
                    </div>
                  )}

                  {result.incoherences && result.incoherences.length > 0 && (
                    <ul className="space-y-2">
                      {result.incoherences.map((inc, i) => (
                        <li key={i} className="text-sm text-amber-700 bg-amber-50 px-4 py-2 rounded-lg">
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

        <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
            Mes documents
          </h3>
          {unified.length === 0 ? (
            <div className="bg-white border border-border rounded-2xl p-6 text-center text-ink/40 text-sm">
              Aucun document analysé.
            </div>
          ) : (
            <div className="space-y-3">
              {unified.map((doc) => (
                <div
                  key={doc.document_id}
                  className={`w-full bg-white border rounded-2xl p-5 space-y-1 card-hover transition-all duration-200 ${
                    selectedId === doc.document_id ? "border-teal-dark" : "border-border hover:border-ink/30"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(doc.document_id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 ${
                            doc.kind === "virement" ? "bg-prune/10 text-prune" : "bg-teal-dark/10 text-teal-dark"
                          }`}
                        >
                          {doc.kind === "virement" ? "Virement" : "Facture"}
                        </span>
                        <span className="font-semibold text-sm truncate">{doc.label}</span>
                      </span>
                      <span className="font-mono text-xs text-ink/50 shrink-0 text-right">
                        {doc.amount != null ? `${formatMoney(doc.amount)} ${doc.currency ?? "€"}` : "—"}
                        {doc.amount_eur != null && doc.currency !== "EUR" && (
                          <span className="block text-ink/30">≈ {formatMoney(doc.amount_eur)} €</span>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-ink/50 mt-1">{doc.subtitle}</p>
                  </button>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setChatDoc({ id: doc.document_id, label: doc.label })}
                      className="size-7 rounded-full border border-border hover:border-teal-dark transition-all duration-200 active:scale-[0.95] grid place-items-center text-sm"
                      title="Poser une question sur ce document"
                    >
                      💬
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeDoc && !result && (
            <div className="bg-white border border-border rounded-2xl p-6">
              <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                Synthèse
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
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
