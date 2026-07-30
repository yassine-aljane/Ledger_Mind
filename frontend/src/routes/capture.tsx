import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import { PremiumPagePlaceholder } from "@/components/lm/PremiumPagePlaceholder";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { isAuthed } from "@/lib/auth";
import {
  analyzeCapture,
  answerCapture,
  askCaptureQuestion,
  fetchCaptureInvoices,
  formatMoney,
  type CaptureAnalyzeResult,
  type CaptureInvoiceItem,
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

const PIPELINE = ["OCR", "Extraction", "Classification", "Déductibilité", "Sauvegarde"];

function pipelineStep(status: CaptureAnalyzeResult["status"] | null, idx: number): boolean {
  if (!status) return false;
  if (status === "erreur") return idx === 0;
  if (status === "en_attente_utilisateur") return idx < 3;
  return true;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    fetchCaptureInvoices()
      .then(setInvoices)
      .catch(() => {});
  }, [navigate]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    setLoading(true);
    setError(null);
    setResult(null);
    setQaAnswer(null);
    try {
      const res = await analyzeCapture(file);
      setResult(res);
      setThreadId(res.thread_id);
      if (res.document_id) setSelectedId(res.document_id);
      if (res.status === "completed") {
        const list = await fetchCaptureInvoices();
        setInvoices(list);
      }
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
        if (res.analyze.status === "completed") {
          const list = await fetchCaptureInvoices();
          setInvoices(list);
        }
        if (res.analyze.status === "erreur") {
          setError(res.analyze.error || res.error || "Erreur.");
        }
      } else if (res.answer) {
        setQaAnswer(res.answer);
      }
      setHitlAnswer("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setLoading(false);
    }
  }

  async function handleQa(e: React.FormEvent) {
    e.preventDefault();
    const docId = selectedId || result?.document_id;
    if (!docId || !qaQuestion.trim()) return;
    setQaLoading(true);
    setQaAnswer(null);
    try {
      const res = await askCaptureQuestion(docId, qaQuestion.trim());
      if (res.error) setError(res.error);
      else setQaAnswer(res.answer ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur Q&A.");
    } finally {
      setQaLoading(false);
    }
  }

  const activeInvoice = invoices.find((i) => i.document_id === selectedId);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Documents"
        title={
          <>
            Déposez, on <span className="italic font-normal">s'occupe du reste.</span>
          </>
        }
        description="PDF ou image — l'agent capture extrait, qualifie et classe chaque facture automatiquement."
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
              {loading ? "Analyse en cours…" : "Glissez une facture ici"}
            </p>
            <p className="text-sm text-ink/50 mt-2">
              PDF, image · analyse OCR + classification · 20 Mo max
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

              {result.status === "completed" && result.invoice && (
                <div className="space-y-4 border-t border-border pt-6">
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">
                        Émetteur
                      </p>
                      <p className="font-medium">{result.invoice.issuer_name ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">
                        N° facture
                      </p>
                      <p className="font-mono">{result.invoice.invoice_number ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">
                        Total TTC
                      </p>
                      <p className="font-mono text-lg">
                        {result.invoice.total_ttc != null
                          ? `${formatMoney(result.invoice.total_ttc)} ${result.invoice.currency ?? "€"}`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">
                        Catégorie
                      </p>
                      <p className="font-medium capitalize">{result.expense_category ?? "—"}</p>
                    </div>
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

          {(selectedId || result?.document_id) && (
            <section className="bg-white border border-border rounded-2xl p-8 space-y-4">
              <h3 className="text-xl font-semibold">Question sur ce document</h3>
              <form onSubmit={handleQa} className="space-y-3">
                <input
                  type="text"
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                  placeholder="Ex. Cette facture est-elle déductible ?"
                  className="w-full px-4 py-3 border border-border rounded-xl text-sm input-boxed focus:outline-none focus:border-ink"
                />
                <button
                  type="submit"
                  disabled={qaLoading || !qaQuestion.trim()}
                  className="px-6 py-3 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
                >
                  {qaLoading ? "…" : "Poser la question"}
                </button>
              </form>
              {qaAnswer && (
                <p className="text-sm text-ink/80 bg-background rounded-xl p-4 leading-relaxed">
                  {qaAnswer}
                </p>
              )}
            </section>
          )}
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
            Mes factures
          </h3>
          {invoices.length === 0 ? (
            <div className="bg-white border border-border rounded-2xl p-6 text-center text-ink/40 text-sm">
              Aucune facture analysée.
            </div>
          ) : (
            <div className="space-y-3">
              {invoices.map((inv) => (
                <button
                  key={inv.document_id}
                  type="button"
                  onClick={() => {
                    setSelectedId(inv.document_id);
                    setQaAnswer(null);
                  }}
                  className={`w-full text-left bg-white border rounded-2xl p-5 space-y-1 card-hover transition-all duration-200 ${
                    selectedId === inv.document_id
                      ? "border-teal-dark"
                      : "border-border hover:border-ink/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">
                      {inv.invoice.issuer_name ?? "Facture"}
                    </span>
                    <span className="font-mono text-xs text-ink/50 shrink-0">
                      {inv.invoice.total_ttc != null
                        ? `${formatMoney(inv.invoice.total_ttc)} €`
                        : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-ink/50">
                    {inv.expense_category ?? "—"} · {inv.invoice.issue_date ?? "date inconnue"}
                  </p>
                </button>
              ))}
            </div>
          )}

          {activeInvoice?.analysis && !result && (
            <div className="bg-white border border-border rounded-2xl p-6">
              <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                Synthèse
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">{activeInvoice.analysis}</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
