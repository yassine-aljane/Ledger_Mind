import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  MessageSquarePlus,
  Radio,
  Send,
  Trash2,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ParcoursStrip, UpsellStrip } from "@/components/paywall";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  Spinner,
  Textarea,
  formatDate,
} from "@/components/ui-kit";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type {
  EducationAnswer,
  EducationConversationSummary,
  EducationMessage,
  EducationSource,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/education")({
  head: () => ({
    meta: [
      { title: "Éducation fiscale — LedgerMind" },
      {
        name: "description",
        content:
          "Posez vos questions de fiscalité française : micro-entreprise, TVA, seuils, charges. Réponses sourcées BOFiP — accessible sans compte.",
      },
      { property: "og:title", content: "Éducation fiscale — LedgerMind" },
      {
        property: "og:description",
        content: "Assistant fiscal sourcé BOFiP, ouvert à tous sans inscription.",
      },
    ],
  }),
  component: EducationPage,
});

const SUGGESTIONS = [
  "Quels sont les seuils de la micro-entreprise en 2025 ?",
  "Quand dois-je facturer la TVA en franchise en base ?",
  "Quelle différence entre BIC et BNC pour un créateur de contenu ?",
  "Quelles charges puis-je déduire au régime réel ?",
];

const FOLLOWUPS = [
  "Je n'ai pas compris, peux-tu reformuler ?",
  "Peux-tu donner un exemple concret ?",
  "Peux-tu expliquer plus simplement ?",
];

interface Turn {
  role: "user" | "assistant";
  content: string;
  data?: EducationAnswer;
}

function EducationPage() {
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [concerne, setConcerne] = useState("");
  const [showConcerne, setShowConcerne] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [regimeHint, setRegimeHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ["rag-status"],
    queryFn: () => api.ragStatus(),
    retry: false,
  });

  const conversations = useQuery({
    queryKey: ["education-conversations"],
    queryFn: () => api.conversations(),
    enabled: !!user,
    retry: false,
  });

  const ask = useMutation({
    mutationFn: (q: string) => {
      const historique: EducationMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
      return api.ask({
        question: q,
        concerne: concerne.trim() || undefined,
        historique,
        conversation_id: user ? conversationId : null,
        use_guidance_context: !!user,
      });
    },
    onSuccess: (data) => {
      if (data.conversation_id) setConversationId(data.conversation_id);
      if (data.regime_verdict) setRegimeHint(data.regime_verdict);
      setTurns((t) => [...t, { role: "assistant", content: data.answer, data }]);
      if (user) void qc.invalidateQueries({ queryKey: ["education-conversations"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, ask.isPending]);

  function submit(raw: string) {
    const q = raw.trim();
    if (q.length < 3 || q.length > 2000 || ask.isPending) return;
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    ask.mutate(q);
  }

  async function loadConversation(id: string) {
    try {
      const row = await api.conversation(id);
      setConversationId(row.id);
      const next: Turn[] = [];
      for (const m of row.messages || []) {
        if (m.role === "user") {
          next.push({ role: "user", content: m.content });
        } else if (m.role === "assistant") {
          next.push({
            role: "assistant",
            content: m.content,
            data: {
              answer: m.content,
              sources: m.sources || [],
              freshness_warning: false,
              corpus_empty: false,
              bofip_live_used: false,
              conversation_id: row.id,
            },
          });
        }
      }
      setTurns(next);
    } catch (err) {
      console.error(err);
    }
  }

  function newConversation() {
    setConversationId(null);
    setTurns([]);
    setRegimeHint(null);
  }

  const tooShort = question.trim().length > 0 && question.trim().length < 3;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Ouvert à tous · sans compte"
        title="Éducation fiscale"
        description="Interrogez la doctrine fiscale française. Chaque réponse cite ses sources et signale les textes obsolètes — pas besoin de vous connecter."
        actions={
          status.data ? (
            <Badge tone={status.data.corpus_chunks > 0 ? "success" : "warning"}>
              <Database className="size-3" /> {status.data.corpus_chunks} extraits indexés
            </Badge>
          ) : undefined
        }
      />

      <div
        className={cn(
          "grid gap-6",
          user ? "lg:grid-cols-[240px_minmax(0,1fr)_300px]" : "lg:grid-cols-[minmax(0,1fr)_300px]",
        )}
      >
        {user && (
          <aside className="space-y-3">
            <Button variant="outline" size="sm" className="w-full" onClick={newConversation}>
              <MessageSquarePlus className="size-3.5" /> Nouvelle conversation
            </Button>
            {conversations.isError && (
              <ErrorBlock
                message="Historique indisponible."
                onRetry={() => void conversations.refetch()}
              />
            )}
            {conversations.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucune conversation enregistrée.</p>
            )}
            <ul className="space-y-1">
              {conversations.data?.map((c: EducationConversationSummary) => (
                <li key={c.id}>
                  <div
                    className={cn(
                      "group flex items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                      conversationId === c.id
                        ? "border-accent bg-accent/10"
                        : "border-border hover:bg-secondary",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void loadConversation(c.id)}
                    >
                      <p className="truncate font-medium">{c.title || "Sans titre"}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDate(c.updated_at)}</p>
                    </button>
                    <button
                      type="button"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Supprimer"
                      onClick={async () => {
                        await api.deleteConversation(c.id);
                        if (conversationId === c.id) newConversation();
                        void qc.invalidateQueries({ queryKey: ["education-conversations"] });
                      }}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="space-y-4">
          {turns.length === 0 && !ask.isPending && (
            <Card className="animate-rise surface-grain p-8">
              <h2 className="text-2xl">Par quoi commencer ?</h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                Décrivez votre situation en une phrase. Plus le contexte est précis (activité, chiffre
                d'affaires, année), plus la réponse est utile.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-xl border border-border bg-card p-4 text-left text-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-soft"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="animate-rise max-w-[85%] rounded-2xl rounded-br-md bg-primary px-5 py-3 text-sm text-primary-foreground">
                  {t.content}
                </p>
              </div>
            ) : (
              <AnswerCard key={i} answer={t.data!} />
            ),
          )}

          {ask.isPending && (
            <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Spinner /> LedgerMind consulte la doctrine fiscale…
            </Card>
          )}

          {ask.isError && (
            <ErrorBlock
              message={
                ask.error instanceof ApiError
                  ? ask.error.message
                  : "La réponse n'a pas pu être générée."
              }
              onRetry={() => {
                const last = [...turns].reverse().find((t) => t.role === "user");
                if (last) ask.mutate(last.content);
              }}
            />
          )}

          {turns.some((t) => t.role === "assistant") && !ask.isPending && (
            <div className="flex flex-wrap gap-2">
              {FOLLOWUPS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => submit(label)}
                  className="rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />

          <Card className="sticky bottom-24 z-20 space-y-3 p-4 lg:bottom-6">
            {showConcerne && (
              <Field label="Ce que ça concerne (optionnel)" htmlFor="concerne">
                <Input
                  id="concerne"
                  value={concerne}
                  onChange={(e) => setConcerne(e.target.value)}
                  placeholder="Ex. micro-BNC, création 2025, prestations à l'étranger"
                  maxLength={200}
                />
              </Field>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(question);
              }}
              className="space-y-3"
            >
              <Textarea
                rows={3}
                value={question}
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question);
                }}
                placeholder="Votre question fiscale…"
                aria-label="Votre question fiscale"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowConcerne((v) => !v)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {concerne ? `Contexte : ${concerne.slice(0, 24)}` : "+ Ajouter un contexte"}
                  </button>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      tooShort ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {question.trim().length}/2000
                  </span>
                </div>
                <Button
                  type="submit"
                  variant="safran"
                  disabled={ask.isPending || question.trim().length < 3}
                >
                  {ask.isPending ? <Spinner /> : <Send />} Demander
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          {user ? (
            <>
              <UpsellStrip text="Après la réponse, passez à l'action avec votre feuille de route personnalisée." />
              <ParcoursStrip text="Complétez votre parcours fiscal pour débloquer le tableau de bord, la capture et les cabinets." />
            </>
          ) : (
            <Card className="p-5">
              <p className="rule-label text-muted-foreground">Agent pédagogique complet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                RAG, sources BOFiP et contrôle de fraîcheur — le même agent, sans créer de compte.
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Un compte permet seulement de sauvegarder l'historique et d'accéder au parcours Premium.
              </p>
              <ButtonLink to="/auth" variant="outline" size="sm" className="mt-4 w-full">
                Sauvegarder mon historique
              </ButtonLink>
            </Card>
          )}
          {regimeHint && (
            <Card className="p-5">
              <p className="rule-label text-muted-foreground">Aligné sur votre diagnostic</p>
              <p className="mt-2 text-sm font-medium">{regimeHint}</p>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-lg">Comment lire les réponses</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Badge tone="info" className="shrink-0">
                  Source
                </Badge>
                Chaque extrait renvoie au texte officiel consulté.
              </li>
              <li className="flex gap-2">
                <Badge tone="warning" className="shrink-0">
                  Périmé
                </Badge>
                Le texte cité a été remplacé — vérifiez l'année.
              </li>
              <li className="flex gap-2">
                <Badge tone="accent" className="shrink-0">
                  BOFiP live
                </Badge>
                La réponse a interrogé le BOFiP en direct.
              </li>
            </ul>
          </Card>
          {status.data?.corpus_chunks === 0 && (
            <EmptyState
              title="Corpus local vide"
              description="Les réponses s'appuieront sur le BOFiP live. Pour un corpus local, lancez le script d'ingestion côté backend."
            />
          )}
          {status.isError && (
            <ErrorBlock
              message="Statut du corpus indisponible."
              onRetry={() => void status.refetch()}
            />
          )}
          {user && (
            <p className="px-1 text-xs text-muted-foreground">
              Voir aussi l'
              <Link to="/historique" className="underline decoration-accent underline-offset-4">
                historique
              </Link>{" "}
              de vos parcours.
            </p>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function AnswerCard({ answer }: { answer: EducationAnswer }) {
  return (
    <Card className="animate-rise overflow-hidden">
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          {answer.bofip_live_used && (
            <Badge tone="accent">
              <Radio className="size-3" /> BOFiP consulté en direct
            </Badge>
          )}
          {answer.corpus_empty && (
            <Badge tone="warning">
              <Database className="size-3" /> Corpus local vide
            </Badge>
          )}
        </div>

        {answer.freshness_warning && (
          <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Certains textes cités peuvent être obsolètes — vérifiez la date de publication.
          </p>
        )}

        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
          {answer.answer}
        </div>
      </div>

      {!!answer.sources?.length && (
        <div className="border-t border-border bg-secondary/40 p-5">
          <p className="rule-label mb-3 text-muted-foreground">
            {answer.sources.length} source{answer.sources.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-2">
            {answer.sources.map((s, i) => (
              <SourceRow key={i} source={s} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SourceRow({ source }: { source: EducationSource }) {
  const label = source.titre || source.source || "Source";
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline decoration-accent underline-offset-4"
        >
          {label} <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <span className="font-medium">{label}</span>
      )}
      {source.date_publication && (
        <span className="text-xs text-muted-foreground">{formatDate(source.date_publication)}</span>
      )}
      {source.perime && <Badge tone="warning">Périmé</Badge>}
      {typeof source.score === "number" && (
        <span className="font-mono text-xs text-muted-foreground">
          pertinence {(source.score * 100).toFixed(0)}%
        </span>
      )}
    </li>
  );
}
