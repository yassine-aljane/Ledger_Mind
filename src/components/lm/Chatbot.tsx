import { useEffect, useRef, useState } from "react";

export type ChatTurn = {
  id: string;
  role: "assistant" | "user";
  text: string;
  time: string;
};

export type ChatQuestion = {
  step: number;
  total: number;
  question: string;
  quickReplies: string[];
};

function nowTime() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function Chatbot({
  fetchNext,
  onFinish,
  eyebrow = "Diagnostic",
  intro,
}: {
  fetchNext: (step: number) => Promise<ChatQuestion | null>;
  onFinish: (transcript: ChatTurn[]) => void;
  eyebrow?: string;
  intro?: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [current, setCurrent] = useState<ChatQuestion | null>(null);
  const [step, setStep] = useState(0);
  const [thinking, setThinking] = useState(true);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setThinking(true);
    fetchNext(step).then((q) => {
      if (cancelled) return;
      if (!q) {
        setThinking(false);
        onFinish(turns);
        return;
      }
      setCurrent(q);
      setTurns((prev) => [
        ...prev,
        { id: `a-${step}`, role: "assistant", text: q.question, time: nowTime() },
      ]);
      setThinking(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, thinking]);

  const handleAnswer = (text: string) => {
    if (!text.trim()) return;
    setTurns((prev) => [
      ...prev,
      { id: `u-${step}`, role: "user", text: text.trim(), time: nowTime() },
    ]);
    setInput("");
    setCurrent(null);
    setStep((s) => s + 1);
  };

  const progress = current ? current.step / current.total : 1;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div className="flex items-center justify-between gap-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
          {eyebrow}
        </p>
        <div className="flex-1 h-[3px] bg-border rounded-full overflow-hidden max-w-xs">
          <div
            className="h-full bg-teal-dark transition-all duration-500 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="font-mono text-[11px] text-ink/50">
          {current ? `${current.step}/${current.total}` : "—"}
        </p>
      </div>

      {intro && turns.length === 0 && (
        <p className="text-ink/60 text-pretty">{intro}</p>
      )}

      <div className="space-y-6 min-h-[360px]">
        {turns.map((t) =>
          t.role === "assistant" ? (
            <div key={t.id} className="flex flex-col gap-1 max-w-[85%] animate-slide-up">
              <div className="p-4 bg-white border border-border rounded-2xl rounded-bl-none text-[15px] leading-relaxed text-ink shadow-sm">
                {t.text}
              </div>
              <span className="text-[10px] uppercase opacity-40 font-mono ml-1">
                {t.time} — Assistant
              </span>
            </div>
          ) : (
            <div key={t.id} className="flex flex-col gap-1 max-w-[85%] ml-auto items-end animate-slide-up">
              <div className="p-4 bg-teal-dark text-background rounded-2xl rounded-br-none text-[15px] font-medium">
                {t.text}
              </div>
              <span className="text-[10px] uppercase opacity-40 font-mono mr-1">
                {t.time} — Vous
              </span>
            </div>
          ),
        )}
        {thinking && (
          <div className="flex items-center gap-2 text-ink/40 text-sm animate-fade-in">
            <span className="size-1.5 rounded-full bg-teal-dark animate-pulse" />
            <span className="font-mono text-xs">L'assistant réfléchit…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {current && !thinking && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2">
            {current.quickReplies.map((r) => (
              <button
                key={r}
                onClick={() => handleAnswer(r)}
                className="px-4 py-2 bg-white border border-border rounded-full text-xs font-semibold hover:border-teal-dark hover:text-teal-dark transition-colors"
              >
                {r}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAnswer(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ou tapez votre réponse librement…"
              className="flex-1 px-5 py-3 bg-white border border-border rounded-full text-sm placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-3 bg-ink text-background rounded-full text-sm font-semibold hover:bg-teal-dark transition-colors"
            >
              Envoyer
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
