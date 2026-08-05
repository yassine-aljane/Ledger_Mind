import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CopyCheck,
  FileQuestion,
  FileSignature,
  FileText,
  Gift,
  HelpCircle,
  Loader2,
  Send,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isAuthed } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { DocumentChatDrawer } from "@/components/lm/DocumentChatDrawer";
import { DocumentInspector } from "@/components/lm/DocumentInspector";
import { CadeauDeclaration } from "@/components/lm/CadeauDeclaration";
import {
  analyzeCapture,
  answerCapture,
  deleteCaptureDocument,
  fetchCaptureCadeaux,
  fetchCaptureContrats,
  fetchCaptureInvoices,
  fetchCaptureVirements,
  formatMoney,
  libelleCadeau,
  type CaptureAnalyzeResult,
  type CaptureCadeauItem,
  type CaptureContratItem,
  type CaptureInvoiceItem,
  type CapturePending,
  type CaptureVirementItem,
} from "@/lib/api";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Justificatifs — LedgerMind" },
      { name: "description", content: "Déposez vos factures, relevés et justificatifs." },
      { property: "og:title", content: "Documents — LedgerMind" },
      { property: "og:description", content: "Déposez vos factures, relevés et justificatifs." },
    ],
  }),
  component: CaptureRoute,
});

function CaptureRoute() {
  return (
    <AccessGate feature="capture" premiumKind="capture">
      <CapturePage />
    </AccessGate>
  );
}

const PIPELINE = ["OCR", "Extraction", "Classification", "Vérifications", "Sauvegarde"];

// -------- File d'attente de dépôt --------
type ItemStatus =
  | "attente"
  | "analyse"
  | "question"
  | "termine"
  | "doublon"
  | "non_reconnu"
  | "erreur";

type QueueItem = {
  key: string;
  name: string;
  file: File;
  status: ItemStatus;
  threadId?: string | null;
  documentId?: string | null;
  pending?: CapturePending | null;
  message?: string | null;
};

const TERMINAL: ItemStatus[] = ["termine", "doublon", "non_reconnu", "erreur"];

const STATUS_LABEL: Record<ItemStatus, string> = {
  attente: "En attente",
  analyse: "Analyse en cours",
  question: "Information requise",
  termine: "Terminé",
  doublon: "Doublon ignoré",
  non_reconnu: "Type non pris en charge",
  erreur: "Échec",
};

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === "analyse") return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  if (status === "termine") return <CheckCircle2 className="size-4 shrink-0 text-success-ink" />;
  if (status === "doublon") return <CopyCheck className="size-4 shrink-0 text-info-ink" />;
  if (status === "erreur") return <XCircle className="size-4 shrink-0 text-destructive" />;
  if (status === "question") return <HelpCircle className="size-4 shrink-0 text-warning-ink" />;
  if (status === "non_reconnu") return <FileQuestion className="size-4 shrink-0 text-warning-ink" />;
  return <CircleDashed className="size-4 shrink-0 text-muted-foreground/60" />;
}

// -------- Fusion facture/virement/contrat/cadeau pour un affichage unifié --------
type DocKind = "facture" | "virement" | "contrat" | "cadeau";

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

const KIND_LABEL: Record<DocKind, string> = {
  facture: "Facture",
  virement: "Virement",
  contrat: "Contrat",
  cadeau: "Cadeau",
};

function KindIcon({ kind }: { kind: DocKind }) {
  if (kind === "virement") return <ArrowLeftRight />;
  if (kind === "contrat") return <FileSignature />;
  if (kind === "cadeau") return <Gift />;
  return <FileText />;
}

/** Une partie du contrat qui n'est pas l'utilisateur : c'est elle qui l'identifie. */
function contratLabel(c: CaptureContratItem["contract"]): string {
  if (c.title) return c.title;
  const partie = (c.parties ?? []).find((p) => p.name)?.name;
  if (partie) return partie;
  return c.contract_type ? `Contrat de ${c.contract_type}` : "Contrat";
}

function unifyDocs(
  invoices: CaptureInvoiceItem[],
  virements: CaptureVirementItem[],
  contrats: CaptureContratItem[],
  cadeaux: CaptureCadeauItem[],
): UnifiedDoc[] {
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
  const fromContrats: UnifiedDoc[] = contrats.map((c) => ({
    document_id: c.document_id,
    kind: "contrat",
    label: contratLabel(c.contract),
    subtitle: `${c.contract.contract_type ?? "—"} · ${
      c.contract.start_date ? `depuis le ${c.contract.start_date}` : "date inconnue"
    }`,
    amount: c.contract.amount,
    currency: c.contract.currency,
    amount_eur: c.contract.amount_eur ?? null,
    created_at: c.created_at ?? null,
  }));
  const fromCadeaux: UnifiedDoc[] = cadeaux.map((c) => ({
    document_id: c.document_id,
    kind: "cadeau",
    label: libelleCadeau(c.cadeau),
    subtitle: `Avantage en nature · ${c.cadeau.date_reception ?? "date inconnue"}`,
    // La valeur RETENUE, jamais l'estimation : la liste affiche ce qui sera déclaré.
    amount: c.cadeau.valeur_ttc ?? null,
    currency: c.cadeau.devise ?? "EUR",
    amount_eur: c.cadeau.valeur_eur ?? null,
    created_at: c.created_at ?? null,
  }));
  return [...fromInvoices, ...fromVirements, ...fromContrats, ...fromCadeaux].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
}

function CapturePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [depositMode, setDepositMode] = useState<"documents" | "cadeau">("documents");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [hitlAnswer, setHitlAnswer] = useState("");
  const [hitlSending, setHitlSending] = useState(false);
  const [invoices, setInvoices] = useState<CaptureInvoiceItem[]>([]);
  const [virements, setVirements] = useState<CaptureVirementItem[]>([]);
  const [contrats, setContrats] = useState<CaptureContratItem[]>([]);
  const [cadeaux, setCadeaux] = useState<CaptureCadeauItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chatDoc, setChatDoc] = useState<{ id: string; label: string } | null>(null);
  const [toDelete, setToDelete] = useState<UnifiedDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Références stables : le moteur de file les liste en dépendances, et des
  // fonctions recréées à chaque rendu le relanceraient en boucle.
  const reloadLists = useCallback(async () => {
    const [inv, vir, con, cad] = await Promise.all([
      fetchCaptureInvoices(),
      fetchCaptureVirements(),
      fetchCaptureContrats(),
      fetchCaptureCadeaux(),
    ]);
    setInvoices(inv);
    setVirements(vir);
    setContrats(con);
    setCadeaux(cad);
  }, []);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    reloadLists().catch(() => {});
  }, [navigate, reloadLists]);

  /** Un clic ouvre la fiche du document, un second la referme. */
  function toggleDoc(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  // La fiche s'ouvre sous les deux colonnes, donc hors écran sur un portable.
  useEffect(() => {
    if (!openId) return;
    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openId]);

  const patch = useCallback((key: string, changes: Partial<QueueItem>) => {
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }, []);

  /** Traduit une réponse d'analyse en état de file. */
  const applyResult = useCallback(
    (key: string, res: CaptureAnalyzeResult) => {
      if (res.status === "en_attente_utilisateur") {
        patch(key, {
          status: "question",
          threadId: res.thread_id,
          documentId: res.document_id,
          pending: res.pending ?? null,
        });
        return;
      }
      // Document hors périmètre : lu sans encombre, mais rien à en extraire.
      // Ce n'est pas un échec, et il n'y a pas de fiche à ouvrir.
      if (res.status === "non_pris_en_charge") {
        patch(key, {
          status: "non_reconnu",
          message: res.message || "Ce document n'est ni une facture, ni un virement, ni un contrat.",
          pending: null,
        });
        return;
      }
      if (res.status === "erreur") {
        patch(key, { status: "erreur", message: res.error || "Erreur lors de l'analyse." });
        return;
      }
      // Un doublon écarté n'est pas enregistré : il n'a pas de fiche à consulter.
      if (res.duplicate_skipped === true || res.saved === false) {
        patch(key, { status: "doublon", documentId: res.document_id, pending: null });
        return;
      }
      patch(key, { status: "termine", documentId: res.document_id, pending: null });
      if (res.document_id) setOpenId(res.document_id);
    },
    [patch],
  );

  /**
   * Un seul document à la fois, et rien ne part tant qu'une question reste
   * ouverte : le graphe d'analyse peut s'interrompre pour demander une
   * précision, et deux interruptions concurrentes n'auraient pas de réponse
   * distincte côté interface. La sérialisation ménage aussi le quota du
   * fournisseur LLM, qu'un envoi simultané épuiserait d'un coup.
   */
  useEffect(() => {
    if (runningRef.current) return;
    if (queue.some((it) => it.status === "question" || it.status === "analyse")) return;
    const next = queue.find((it) => it.status === "attente");
    if (!next) return;

    runningRef.current = true;
    patch(next.key, { status: "analyse" });

    (async () => {
      try {
        const res = await analyzeCapture(next.file);
        if (res.status === "completed") await reloadLists();
        applyResult(next.key, res);
      } catch (err) {
        patch(next.key, {
          status: "erreur",
          message: err instanceof Error ? err.message : "Erreur inattendue.",
        });
      } finally {
        runningRef.current = false;
      }
    })();
  }, [queue, patch, applyResult, reloadLists]);

  function enqueue(files: FileList | File[] | null) {
    if (!files?.length) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    const added: QueueItem[] = list.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      file,
      status: "attente",
    }));
    setQueue((q) => [...q, ...added]);
    // Le champ garde son contenu : sans reset, redéposer les mêmes fichiers
    // n'émettrait aucun `change`.
    if (fileRef.current) fileRef.current.value = "";
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCaptureDocument(toDelete.document_id);
      // La fiche ouverte porterait sur une pièce disparue.
      if (openId === toDelete.document_id) setOpenId(null);
      if (chatDoc?.id === toDelete.document_id) setChatDoc(null);
      await reloadLists();
      setToDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  }

  const asking = queue.find((it) => it.status === "question");

  async function handleHitlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!asking?.threadId || !hitlAnswer.trim()) return;
    setHitlSending(true);
    try {
      const res = await answerCapture(asking.threadId, hitlAnswer.trim());
      if (res.analyze) {
        if (res.analyze.status === "completed") await reloadLists();
        applyResult(asking.key, res.analyze);
      } else if (res.error) {
        patch(asking.key, { status: "erreur", message: res.error });
      }
      setHitlAnswer("");
    } catch (err) {
      patch(asking.key, {
        status: "erreur",
        message: err instanceof Error ? err.message : "Erreur inattendue.",
      });
    } finally {
      setHitlSending(false);
    }
  }

  const unified = unifyDocs(invoices, virements, contrats, cadeaux);
  const openDoc = unified.find((d) => d.document_id === openId);
  const analysing = queue.find((it) => it.status === "analyse");
  const done = queue.filter((it) => TERMINAL.includes(it.status)).length;
  const busy = queue.some((it) => !TERMINAL.includes(it.status));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Justificatifs"
        title={
          <>
            Déposez, on <span className="italic font-normal">s'occupe du reste.</span>
          </>
        }
        description="Factures, virements, contrats et cadeaux — extrait, classé, prêt à justifier."
      />

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="space-y-3">
            <h2 className="rule-label text-accent-ink">Déposer</h2>

            <div
              className="flex rounded-2xl border border-border bg-card p-1.5 shadow-soft"
              role="tablist"
              aria-label="Type de dépôt"
            >
              <button
                type="button"
                role="tab"
                aria-selected={depositMode === "documents"}
                onClick={() => setDepositMode("documents")}
                className={cn(
                  "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  depositMode === "documents"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Documents
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={depositMode === "cadeau"}
                onClick={() => setDepositMode("cadeau")}
                className={cn(
                  "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  depositMode === "cadeau"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Cadeau / dotation
              </button>
            </div>

            {depositMode === "documents" ? (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  enqueue(e.dataTransfer.files);
                }}
                className={cn(
                  "flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-border bg-card p-8 text-center shadow-soft transition-all duration-200",
                  dragging ? "bg-accent/10" : "hover:bg-accent/5",
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls"
                  className="sr-only"
                  onChange={(e) => enqueue(e.target.files)}
                />
                <div
                  className={cn(
                    "mb-4 grid size-12 place-items-center rounded-2xl transition-colors",
                    dragging ? "bg-accent/25 text-accent-ink" : "bg-accent/15 text-accent-ink",
                  )}
                >
                  <UploadCloud className="size-5" />
                </div>
                <p className="text-sm font-medium">
                  {dragging ? "Relâchez pour analyser" : "Glissez vos documents ici"}
                </p>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Factures, virements, contrats · PDF ou image · 20 Mo max
                </p>
              </label>
            ) : (
              <CadeauDeclaration onDeclare={() => void reloadLists()} />
            )}
          </section>

          {queue.length > 0 && (
            <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <h3 className="rule-label text-muted-foreground">
                  Traitement · {done}/{queue.length}
                </h3>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    Effacer
                  </button>
                )}
              </div>

              {/* Une barre par lot, pas par fichier : elle mesure l'avancement
                  global, seul repère utile quand on dépose une pile de pièces. */}
              <div
                className="h-1.5 overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuenow={done}
                aria-valuemin={0}
                aria-valuemax={queue.length}
              >
                <div
                  className="h-full rounded-full bg-success transition-all duration-500"
                  style={{ width: `${(done / queue.length) * 100}%` }}
                />
              </div>

              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {queue.map((it) => (
                  <li
                    key={it.key}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm odd:bg-secondary/30"
                  >
                    <StatusIcon status={it.status} />
                    <span className="min-w-0 flex-1 truncate" title={it.name}>
                      {it.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        it.status === "erreur"
                          ? "text-destructive"
                          : it.status === "non_reconnu"
                            ? "text-warning-ink"
                            : "text-muted-foreground",
                      )}
                      title={it.message ?? undefined}
                    >
                      {STATUS_LABEL[it.status]}
                    </span>
                  </li>
                ))}
              </ul>

              {analysing && (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="truncate text-xs text-muted-foreground">
                    OCR, extraction et classification… 30 à 90 secondes par pièce.
                  </p>
                  <div className="grid grid-cols-5 gap-2">
                    {PIPELINE.map((step) => (
                      <div key={step} className="space-y-2">
                        <div className="h-1.5 animate-pulse rounded-full bg-border" />
                        <span className="rule-label block text-muted-foreground">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Écarté n'est pas échoué : le ton reste informatif, et le
                  message dit ce que la pièce semblait être. */}
              {queue.some((it) => it.status === "non_reconnu") && (
                <ul className="space-y-2 border-t border-border pt-3">
                  {queue
                    .filter((it) => it.status === "non_reconnu")
                    .map((it) => (
                      <li
                        key={it.key}
                        className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-ink"
                      >
                        <FileQuestion className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">{it.name}</span> — {it.message}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              {queue.some((it) => it.status === "erreur") && (
                <ul className="space-y-1 border-t border-border pt-3">
                  {queue
                    .filter((it) => it.status === "erreur")
                    .map((it) => (
                      <li key={it.key} className="text-xs text-destructive">
                        <span className="font-medium">{it.name}</span> — {it.message}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}

          {/* Une question suspend la file jusqu'à la réponse. Elle reste collée au suivi
              de traitement dont elle fait partie : c'est une étape du dépôt de
              justificatifs, pas un bloc indépendant. */}
          {asking?.pending && (
            <form
              onSubmit={handleHitlSubmit}
              className="animate-rise space-y-4 rounded-2xl border border-warning/40 bg-warning/8 p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* Confirmer une lecture douteuse et combler un trou ne
                    demandent pas le même geste : le libellé le dit. */}
                <Badge variant="warning">
                  {asking.pending.type === "champ_a_confirmer"
                    ? "Lecture à confirmer"
                    : "Information requise"}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">{asking.name}</span>
              </div>
              <p className="text-sm font-medium">{asking.pending.question}</p>
              {asking.pending.suggestions && asking.pending.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {asking.pending.suggestions.map((s) => (
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
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={!hitlAnswer.trim() || hitlSending}>
                  <Send /> Envoyer
                </Button>
                {queue.some((it) => it.status === "attente") && (
                  <p className="text-xs text-muted-foreground">
                    Les pièces suivantes reprendront après votre réponse.
                  </p>
                )}
              </div>
            </form>
          )}

        </div>

        {/* Colonne bibliothèque */}
        <div className="space-y-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="rule-label text-accent-ink">Mes documents</h2>
            {unified.length > 0 && (
              <span className="num text-xs text-muted-foreground">
                {unified.length} pièce{unified.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {unified.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border p-8 text-center">
              <div className="space-y-2">
                <FileText className="mx-auto size-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Aucun document analysé pour l'instant.
                </p>
              </div>
            </div>
          ) : (
            <ul className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {unified.map((doc) => {
                const open = openId === doc.document_id;
                return (
                  <li key={doc.document_id}>
                    {/* Zone d'ouverture et suppression sont deux boutons frères :
                        un bouton ne peut pas en contenir un autre. */}
                    <div
                      className={cn(
                        "card-hover flex w-full items-center gap-2 rounded-2xl border bg-card p-4 shadow-soft transition-all duration-200",
                        open
                          ? "border-accent ring-1 ring-accent/40"
                          : "border-border hover:border-ink/30",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDoc(doc.document_id)}
                        aria-expanded={open}
                        title={open ? "Masquer les détails" : "Afficher les détails"}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="min-w-0 flex-1 space-y-1.5">
                          <span className="flex items-center gap-2">
                            <Badge
                              variant={
                                doc.kind === "virement"
                                  ? "info"
                                  : doc.kind === "contrat"
                                    ? "warning"
                                    : doc.kind === "cadeau"
                                      ? "accent"
                                      : "success"
                              }
                            >
                              <KindIcon kind={doc.kind} />
                              {KIND_LABEL[doc.kind]}
                            </Badge>
                            <span className="truncate text-sm font-medium">{doc.label}</span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {doc.subtitle}
                          </span>
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
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                            open && "rotate-180 text-accent-ink",
                          )}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setToDelete(doc);
                        }}
                        title="Supprimer ce document"
                        aria-label={`Supprimer ${doc.label}`}
                        className="grid size-8 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-all duration-200 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* La fiche s'ouvre en pleine largeur : l'aperçu et l'analyse tiennent côte à côte. */}
      {openId && (
        <div
          ref={detailsRef}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
            <div className="min-w-0">
              <p className="rule-label text-muted-foreground">Détails du document</p>
              <p className="truncate text-sm font-medium">{openDoc?.label ?? "Document"}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenId(null)}
              title="Masquer les détails"
            >
              <X /> Masquer
            </Button>
          </div>
          <DocumentInspector
            key={openId}
            documentId={openId}
            onChat={(label) => setChatDoc({ id: openId, label })}
          />
        </div>
      )}

      {chatDoc && (
        <DocumentChatDrawer
          documentId={chatDoc.id}
          label={chatDoc.label}
          onClose={() => setChatDoc(null)}
        />
      )}

      {/* La suppression est définitive et emporte la pièce d'origine : elle se confirme. */}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{toDelete?.label}</span>
              {toDelete?.subtitle ? ` — ${toDelete.subtitle}` : ""}
              <br />
              Sa fiche, la pièce d'origine et la discussion associée seront effacées de la base.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {deleteError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Le dialogue se referme par défaut au clic : on garde la main
                // pour n'effacer qu'après confirmation du serveur.
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
