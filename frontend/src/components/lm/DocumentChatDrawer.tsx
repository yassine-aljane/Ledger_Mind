import { useEffect, useRef, useState } from "react";
import {
  askCaptureQuestion,
  fetchCaptureDocumentMessages,
  type CaptureDocumentMessage,
} from "@/lib/api";

type Props = {
  documentId: string;
  label: string;
  onClose: () => void;
};

type Turn = { role: "user" | "assistant"; content: string; pending?: boolean };

export function DocumentChatDrawer({ documentId, label, onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaptureDocumentMessages(documentId)
      .then((messages: CaptureDocumentMessage[]) => {
        if (cancelled) return;
        setTurns(messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || sending) return;
    setQuestion("");
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setSending(true);
    try {
      const res = await askCaptureQuestion(documentId, q);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.answer || res.error || "Je n'ai pas pu répondre." },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : "Erreur inattendue." },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fermer le chat"
        onClick={onClose}
        className="absolute inset-0 bg-ink/30 animate-fade-in"
      />
      <div className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-slide-in-right">
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-5 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
              Question sur ce document
            </p>
            <h3 className="font-semibold truncate">{label}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 size-9 rounded-full border border-border hover:border-ink transition-all duration-200 active:scale-[0.95] grid place-items-center text-ink/60"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll px-6 py-6 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink/40">
              <span className="inline-block size-4 border-2 border-ink/20 border-t-teal-dark rounded-full animate-spin" />
              Chargement de la conversation…
            </div>
          ) : turns.length === 0 ? (
            <p className="text-sm text-ink/40 text-center pt-10">
              Posez une question sur ce document — montant, échéance, cohérence, IBAN…
            </p>
          ) : (
            turns.map((t, i) =>
              t.role === "assistant" ? (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 size-8 rounded-full bg-teal-dark/10 text-teal-dark grid place-items-center text-sm">
                    🤖
                  </div>
                  <div className="p-3.5 bg-background border border-border rounded-2xl rounded-bl-none text-sm leading-relaxed text-ink">
                    {t.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-end">
                  <div className="p-3.5 bg-teal-dark text-background rounded-2xl rounded-br-none text-sm font-medium max-w-[85%]">
                    {t.content}
                  </div>
                </div>
              ),
            )
          )}
          {sending && (
            <div className="flex gap-3">
              <div className="shrink-0 size-8 rounded-full bg-teal-dark/10 text-teal-dark grid place-items-center text-sm">
                🤖
              </div>
              <div className="p-3.5 bg-background border border-border rounded-2xl rounded-bl-none flex gap-1.5">
                <span className="size-1.5 rounded-full bg-teal-dark animate-pulse" />
                <span className="size-1.5 rounded-full bg-teal-dark animate-pulse [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-teal-dark animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="shrink-0 border-t border-border p-4 flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex. Ce virement est-il cohérent ?"
            className="flex-1 px-4 py-3 border border-border rounded-xl text-sm input-boxed focus:outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={sending || !question.trim()}
            className="px-5 py-3 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
          >
            {sending ? "…" : "Envoyer"}
          </button>
        </form>
      </div>
    </div>
  );
}
