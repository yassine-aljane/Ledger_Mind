/**
 * Assistant fiscal — Q&A ancrée sur le corpus documentaire.
 *
 * Même espace conversationnel que la guidance (historique repris, mémoire partagée côté serveur),
 * mais orienté question/réponse : pas de fiche de statut ni de feuille de route ici.
 *
 * Chaque réponse affiche ses SOURCES, dépliables jusqu'à l'extrait exact utilisé, et le cas
 * échéant un avertissement de fraîcheur. L'agent refuse d'inventer un chiffre absent de ses
 * extraits : l'absence de réponse est un résultat acceptable, pas un échec à masquer.
 */

import { Library, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationHistory } from "@/components/lm/ConversationHistory";
import { Markdown } from "@/components/lm/Markdown";
import { Sources } from "@/components/lm/Sources";
import { Badge } from "@/components/ui/badge";
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
} from "@/lib/guidance-api";

const SESSION_KEY = "ledgermind_pedagogue_session";

const QUESTIONS_DEPART = [
  "Je reçois des produits gratuits de marques, dois-je les déclarer ?",
  "Quelle différence entre micro-BNC et micro-BIC ?",
  "Quand dois-je facturer la TVA ?",
];

type Turn = {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: ChatSource[];
  fraicheur?: boolean;
  bofipLive?: boolean;
  error?: string;
};

export function FiscalAssistant() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(() => {
    fetchConversations("pedagogue")
      .then((d) => setConversations(d.conversations))
      .catch(() => setConversations([]));
  }, []);

  const openConversation = useCallback(async (id: string, silent = false) => {
    try {
      const detail = await fetchConversation(id);
      setSessionId(id);
      setTurns(
        detail.messages.map((m, i) => ({
          id: `${m.role}-${i}`,
          role: m.role === "user" ? "user" : "assistant",
          text: m.content,
          sources: m.sources,
        })),
      );
    } catch {
      if (!silent) localStorage.removeItem(SESSION_KEY);
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    refreshConversations();
    // L'état du corpus est purement informatif : s'il n'est pas joignable, l'écran fonctionne
    // à l'identique, on n'affiche simplement pas le badge.
    fetchCorpusStatus()
      .then(setCorpus)
      .catch(() => setCorpus(null));
    const stored = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
    if (stored) void openConversation(stored, true);
  }, [openConversation, refreshConversations]);

  useEffect(() => {
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

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
    }
  }

  const startNew = () => {
    setSessionId(null);
    setTurns([]);
    localStorage.removeItem(SESSION_KEY);
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] gap-6 items-start">
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

      <div className="flex h-[75vh] min-h-[520px] min-w-0 flex-col">
        {/* Même cadre à hauteur fixe que la guidance : les échanges défilent dans leur propre
            zone, la saisie reste toujours visible en bas. */}
        <div className="chat-scroll flex-1 space-y-6 overflow-y-auto pr-2">
          {turns.length === 0 && (
            <div className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <p className="rule-label text-accent-ink">Assistant fiscal sourcé</p>
                {corpus && (
                  <Badge variant={corpus.pret ? "success" : "warning"}>
                    <Library />
                    {corpus.pret
                      ? `${corpus.chunks.toLocaleString("fr-FR")} extraits indexés`
                      : "Corpus en cours d'indexation"}
                  </Badge>
                )}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Posez votre première question. Les réponses s&apos;appuient sur le corpus officiel
                (Légifrance, BOFiP, URSSAF, impots.gouv.fr) et citent leurs sources. Si
                l&apos;information n&apos;y figure pas, l&apos;assistant le dit plutôt que de
                l&apos;inventer.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {QUESTIONS_DEPART.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    style={{ animationDelay: `${i * 60}ms` }}
                    className="suggestion-chip chip-stagger rounded-full px-4 py-2 text-left text-xs font-medium"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {turns.map((turn) =>
              turn.role === "assistant" ? (
                <div key={turn.id} className="animate-rise flex max-w-[90%] flex-col gap-1.5">
                  <div className="rounded-2xl rounded-bl-none border border-border bg-card p-5 text-sm leading-relaxed shadow-soft">
                    {turn.error ? (
                      <span className="text-destructive">Erreur : {turn.error}</span>
                    ) : (
                      <>
                        <Markdown text={turn.text} />
                        <Sources
                          sources={turn.sources}
                          fraicheur={turn.fraicheur}
                          bofipLive={turn.bofipLive}
                        />
                      </>
                    )}
                  </div>
                  <span className="rule-label ml-1 text-muted-foreground">Assistant fiscal</span>
                </div>
              ) : (
                <div
                  key={turn.id}
                  className="animate-rise ml-auto flex max-w-[85%] flex-col items-end gap-1.5"
                >
                  <div className="rounded-2xl rounded-br-none bg-primary p-4 text-sm font-medium text-primary-foreground">
                    {turn.text}
                  </div>
                  <span className="rule-label mr-1 text-muted-foreground">Vous</span>
                </div>
              ),
            )}

            {busy && (
              <div className="animate-fade-in flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="rule-label">Recherche dans les sources officielles…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mt-4 shrink-0 border-t border-border pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question fiscale…"
              aria-label="Votre question fiscale"
              className="flex-1 rounded-full border border-border bg-card px-5 py-2.5 text-sm transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-ink focus:outline-none"
            />
            <Button
              type="submit"
              variant="accent"
              className="rounded-full px-5"
              disabled={busy || !input.trim()}
            >
              <Send /> Demander
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
