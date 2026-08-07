/**
 * Assistant fiscal — Q&A ancrée sur le corpus documentaire.
 *
 * Surface « atelier » LedgerMind : encre, parchemin, safran — tailles alignées sur le rail.
 */

import { Library, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationHistory } from "@/components/lm/ConversationHistory";
import { FiscalVisualisations } from "@/components/lm/FiscalVisualisations";
import { Markdown } from "@/components/lm/Markdown";
import { Sources } from "@/components/lm/Sources";
import { Button } from "@/components/ui/button";
import {
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchCorpusStatus,
  renameConversation,
  sendGuidanceMessage,
  type ChatSource,
  type ConversationSummary,
  type CorpusStatus,
  type FiscalVisualisation,
} from "@/lib/guidance-api";
import { cn } from "@/lib/utils";

const QUESTIONS_DEPART = [
  "Je reçois des produits gratuits de marques, dois-je les déclarer ?",
  "Quelle différence entre micro-BNC et micro-BIC ?",
  "Quand dois-je facturer la TVA ?",
  "Un sponso TikTok, c'est du BNC ?",
];

type Turn = {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: ChatSource[];
  fraicheur?: boolean;
  bofipLive?: boolean;
  visualisations?: FiscalVisualisation[];
  error?: string;
};

function SearchingSources() {
  return (
    <div className="lm-bubble-in flex max-w-[88%] flex-col gap-1.5">
      <div className="rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3.5 shadow-soft">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2">
            <span className="lm-edu-pulse absolute inline-flex size-full rounded-full bg-accent" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          <p className="text-sm text-muted-foreground">Recherche dans les sources officielles…</p>
        </div>
        <div className="mt-2.5 flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="lm-search-dot size-1.5 rounded-full bg-accent-ink/70"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function FiscalAssistant() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshConversations = useCallback(() => {
    fetchConversations("pedagogue")
      .then((d) => setConversations(d.conversations))
      .catch(() => setConversations([]));
  }, []);

  const openConversation = useCallback(async (id: string) => {
    try {
      const detail = await fetchConversation(id);
      setSessionId(id);
      setTurns(
        detail.messages.map((m, i) => ({
          id: `${m.role}-${i}`,
          role: m.role === "user" ? "user" : "assistant",
          text: m.content,
          sources: m.sources,
          visualisations: m.visualisations,
        })),
      );
    } catch {
      setSessionId(null);
      setTurns([]);
    }
  }, []);

  useEffect(() => {
    refreshConversations();
    fetchCorpusStatus()
      .then(setCorpus)
      .catch(() => setCorpus(null));
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setInput("");
    setTurns((prev) => [...prev, { id: `u-${prev.length}`, role: "user", text }]);
    setBusy(true);
    try {
      const data = await sendGuidanceMessage({
        session_id: sessionId,
        message: text,
        mode: "pedagogue",
      });
      const isNew = data.session_id !== sessionId;
      setSessionId(data.session_id);
      const debug = data.debug as Record<string, unknown> | undefined;
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${prev.length}`,
          role: "assistant",
          text: data.reponse,
          sources: data.sources,
          visualisations: data.visualisations,
          fraicheur: Boolean(debug?.avertissement_fraicheur),
          bofipLive: Boolean(debug?.bofip_live_utilise),
        },
      ]);
      if (isNew) refreshConversations();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur réseau — réessayez.";
      setTurns((prev) => [
        ...prev,
        { id: `a-${prev.length}`, role: "assistant", text: "", error: msg },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const startNew = () => {
    setSessionId(null);
    setTurns([]);
    inputRef.current?.focus();
  };

  const empty = turns.length === 0;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-6">
      <aside className="lg:sticky lg:top-24">
        <ConversationHistory
          conversations={conversations}
          currentId={sessionId}
          onOpen={(id) => void openConversation(id)}
          onNew={startNew}
          onRename={(id, title) => {
            void renameConversation(id, title).then(refreshConversations);
          }}
          onDelete={(id) => {
            void deleteConversation(id).then(() => {
              if (id === sessionId) startNew();
              refreshConversations();
            });
          }}
        />
      </aside>

      <div className="relative flex h-[min(75vh,720px)] min-h-[480px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        {/* Halo safran / encre */}
        <div
          className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full opacity-40 blur-3xl"
          style={{ background: "var(--gradient-safran)" }}
          aria-hidden
        />
        <div
          className="lm-edu-breathe pointer-events-none absolute -bottom-16 -left-16 size-48 rounded-full bg-primary/15 blur-3xl"
          aria-hidden
        />

        <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="lm-edu-pulse absolute inline-flex size-full rounded-full bg-success opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-success-ink" />
            </span>
            <p className="text-sm font-medium">Assistant fiscal</p>
          </div>
          {corpus && (
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                corpus.pret ? "text-teal-dark" : "text-warning-ink",
              )}
            >
              <Library className="size-3 opacity-70" />
              {corpus.pret
                ? `${corpus.chunks.toLocaleString("fr-FR")} extraits`
                : "Indexation…"}
            </p>
          )}
        </div>

        <div className="chat-scroll relative flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
          {empty && (
            <div className="animate-rise flex h-full min-h-[280px] flex-col justify-center">
              <p className="rule-label text-accent-ink">Pour commencer</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Une question fiscale — la réponse s&apos;appuie sur le corpus officiel. Si ce
                n&apos;y est pas, l&apos;assistant le dit.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {QUESTIONS_DEPART.map((q, i) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void ask(q)}
                    style={{ animationDelay: `${i * 70}ms` }}
                    className="suggestion-chip chip-stagger rounded-full px-3.5 py-2 text-left text-xs font-medium"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!empty && (
            <>
              {turns.map((turn) =>
                turn.role === "assistant" ? (
                  <div
                    key={turn.id}
                    className={cn(
                      "lm-bubble-in flex flex-col gap-1",
                      turn.visualisations?.length ? "w-full max-w-full" : "max-w-[92%]",
                    )}
                  >
                    <div className="rounded-2xl rounded-bl-md border border-border bg-background/90 p-4 text-sm leading-relaxed shadow-soft">
                      {turn.error ? (
                        <span className="text-destructive">Erreur : {turn.error}</span>
                      ) : (
                        <>
                          <Markdown text={turn.text} />
                          <FiscalVisualisations items={turn.visualisations} />
                          <Sources
                            sources={turn.sources}
                            fraicheur={turn.fraicheur}
                            bofipLive={turn.bofipLive}
                          />
                        </>
                      )}
                    </div>
                    <span className="rule-label ml-1 text-muted-foreground">Assistant</span>
                  </div>
                ) : (
                  <div
                    key={turn.id}
                    className="lm-bubble-in ml-auto flex max-w-[85%] flex-col items-end gap-1"
                  >
                    <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">
                      {turn.text}
                    </div>
                    <span className="rule-label mr-1 text-muted-foreground">Vous</span>
                  </div>
                ),
              )}
              {busy && <SearchingSources />}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="relative shrink-0 border-t border-border bg-card/90 p-3 backdrop-blur-sm sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex items-center gap-2 rounded-full border border-border bg-background p-1.5 shadow-soft transition-shadow focus-within:border-accent/60 focus-within:shadow-lift"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Votre question fiscale…"
              aria-label="Votre question fiscale"
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/55"
            />
            <Button
              type="submit"
              variant="accent"
              size="sm"
              className="rounded-full px-4"
              disabled={busy || !input.trim()}
            >
              <Send className="size-3.5" />
              Envoyer
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
