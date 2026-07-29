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

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationHistory } from "@/components/lm/ConversationHistory";
import { Markdown } from "@/components/lm/Markdown";
import { Sources } from "@/components/lm/Sources";
import {
  deleteConversation,
  fetchConversation,
  fetchConversations,
  renameConversation,
  sendGuidanceMessage,
  type ChatSource,
  type ConversationSummary,
} from "@/lib/guidance-api";

const SESSION_KEY = "ledgermind_pedagogue_session";

const QUESTIONS_DEPART = [
  "Je reçois des produits gratuits de marques, dois-je les déclarer ?",
  "Quelle différence entre micro-BNC et micro-BIC ?",
  "Quand dois-je facturer la TVA ?",
  "Comment facturer un client étranger ?",
  "Mes cotisations URSSAF, comment sont-elles calculées ?",
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

      <div className="min-w-0 space-y-6">
        {turns.length === 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            {QUESTIONS_DEPART.map((q) => (
              <button
                key={q}
                onClick={() => void ask(q)}
                className="group bg-white border border-border rounded-2xl p-5 hover:border-teal-dark transition-colors text-left"
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-teal-dark mb-3">
                  Question fréquente
                </p>
                <p className="text-[15px] font-medium text-balance leading-snug group-hover:text-teal-dark transition-colors">
                  {q}
                </p>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-6">
          {turns.map((turn) =>
            turn.role === "assistant" ? (
              <div key={turn.id} className="flex flex-col gap-1 max-w-[90%] animate-slide-up">
                <div className="p-5 bg-white border border-border rounded-2xl rounded-bl-none text-[15px] leading-relaxed text-ink shadow-sm">
                  {turn.error ? (
                    <span className="text-coral">Erreur : {turn.error}</span>
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
                <span className="text-[10px] uppercase opacity-40 font-mono ml-1">
                  Assistant fiscal
                </span>
              </div>
            ) : (
              <div
                key={turn.id}
                className="flex flex-col gap-1 max-w-[85%] ml-auto items-end animate-slide-up"
              >
                <div className="p-4 bg-teal-dark text-background rounded-2xl rounded-br-none text-[15px] font-medium">
                  {turn.text}
                </div>
                <span className="text-[10px] uppercase opacity-40 font-mono mr-1">Vous</span>
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-2 text-ink/40 text-sm animate-fade-in">
              <span className="size-1.5 rounded-full bg-teal-dark animate-pulse" />
              <span className="font-mono text-xs">Recherche dans les sources officielles…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

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
            className="flex-1 px-5 py-3 bg-white border border-border rounded-full text-sm placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-5 py-3 bg-ink text-background rounded-full text-sm font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
          >
            Demander
          </button>
        </form>
      </div>
    </div>
  );
}
