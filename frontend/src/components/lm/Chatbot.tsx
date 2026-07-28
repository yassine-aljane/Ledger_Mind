import { useEffect, useRef, useState } from "react";
import { orchestratorTurn, type UserProfile } from "@/lib/api";

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
  onFinish,
  fetchNext,
  eyebrow = "Diagnostic",
  intro,
  orchestratorSessionId,
  onOrchestratorFinish,
  initialQuestion,
  initialQuickReplies,
}: {
  onFinish?: (transcript: ChatTurn[]) => void;
  fetchNext?: (step: number) => Promise<ChatQuestion | null>;
  eyebrow?: string;
  intro?: string;
  orchestratorSessionId?: string;
  onOrchestratorFinish?: (profile: UserProfile, transcript: ChatTurn[]) => void;
  initialQuestion?: string;
  initialQuickReplies?: string[];
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [orchestratorMessage, setOrchestratorMessage] = useState<string | null>(null);
  const [orchestratorQuickReplies, setOrchestratorQuickReplies] = useState<string[]>([]);
  const [orchestratorCompleteness, setOrchestratorCompleteness] = useState(0);
  const [currentScriptQuestion, setCurrentScriptQuestion] = useState<ChatQuestion | null>(null);
  const [step, setStep] = useState(0);
  const [thinking, setThinking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const lastCallRef = useRef<{ question: string | null; answer: string | null }>({
    question: null,
    answer: null,
  });

  const isOrchestrator = Boolean(orchestratorSessionId);

  useEffect(() => {
    if (fetchNext) {
      let cancelled = false;
      setThinking(true);
      fetchNext(step).then((q) => {
        if (cancelled) return;
        if (!q) {
          setThinking(false);
          onFinish?.(turns);
          return;
        }
        setCurrentScriptQuestion(q);
        setTurns((prev) => [
          ...prev,
          { id: `a-${step}`, role: "assistant", text: q.question, time: nowTime() },
        ]);
        setThinking(false);
      });
      return () => {
        cancelled = true;
      };
    }

    if (isOrchestrator) {
      if (startedRef.current) return;
      startedRef.current = true;
      if (initialQuestion) {
        setOrchestratorMessage(initialQuestion);
        setOrchestratorQuickReplies(initialQuickReplies ?? []);
        setTurns([{ id: "a-0", role: "assistant", text: initialQuestion, time: nowTime() }]);
        setThinking(false);
      } else {
        void runOrchestratorTurn(null, null);
      }
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, thinking, error]);

  async function runOrchestratorTurn(lastQuestion: string | null, lastAnswer: string | null) {
    if (!orchestratorSessionId) return;
    setError(null);
    setThinking(true);
    lastCallRef.current = { question: lastQuestion, answer: lastAnswer };

    try {
      const result = await orchestratorTurn(
        orchestratorSessionId,
        lastAnswer ?? undefined,
      );
      setThinking(false);

      if (
        result.ui_action === "done" ||
        result.ui_action === "show_compliance" ||
        result.ui_action === "show_tax_result" ||
        result.ui_action === "requires_expert"
      ) {
        setOrchestratorMessage(null);
        setOrchestratorQuickReplies([]);
        onOrchestratorFinish?.(result.profile, turns);
        return;
      }

      if (result.ui_action === "ask_question" && result.message) {
        setOrchestratorMessage(result.message);
        setOrchestratorQuickReplies(result.quick_replies);
        const filled = [
          result.profile.activity_types.length > 0,
          result.profile.revenue_sources.length > 0,
          result.profile.international_clients !== null,
          result.profile.currencies.length > 0,
          result.profile.estimated_monthly_revenue !== null,
          result.profile.revenue_variability !== null,
          result.profile.invoices_already_issued !== null,
          result.profile.has_recurring_contracts !== null,
          result.profile.in_kind_gifts !== null,
          result.profile.first_income_date !== null,
        ].filter(Boolean).length;
        setOrchestratorCompleteness(filled / 10);

        setTurns((prev) => {
          if (!lastAnswer) {
            const alreadyShown = prev.some((t) => t.text === result.message);
            if (alreadyShown) return prev;
          }
          return [
            ...prev,
            {
              id: `a-${prev.length}`,
              role: "assistant",
              text: result.message!,
              time: nowTime(),
            },
          ];
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau — veuillez réessayer.";
      console.error("Orchestrator turn failed:", err);
      setThinking(false);
      setError(msg);
    }
  }

  const handleAnswer = (text: string) => {
    if (!text.trim()) return;
    const answer = text.trim();

    if (fetchNext) {
      setTurns((prev) => [
        ...prev,
        { id: `u-${step}`, role: "user", text: answer, time: nowTime() },
      ]);
      setInput("");
      setCurrentScriptQuestion(null);
      setStep((s) => s + 1);
    } else if (isOrchestrator) {
      const question = orchestratorMessage;
      if (!question) return;
      setTurns((prev) => [
        ...prev,
        { id: `u-${prev.length}`, role: "user", text: answer, time: nowTime() },
      ]);
      setInput("");
      setOrchestratorMessage(null);
      void runOrchestratorTurn(question, answer);
    }
  };

  const handleRetry = () => {
    if (isOrchestrator) {
      const { question, answer } = lastCallRef.current;
      void runOrchestratorTurn(question, answer);
    }
  };

  const activeQuestionText = fetchNext
    ? currentScriptQuestion?.question
    : isOrchestrator
      ? orchestratorMessage
      : null;
  const quickReplies = fetchNext
    ? (currentScriptQuestion?.quickReplies ?? [])
    : isOrchestrator
      ? orchestratorQuickReplies
      : [];
  const progress = fetchNext
    ? currentScriptQuestion
      ? currentScriptQuestion.step / currentScriptQuestion.total
      : 1
    : isOrchestrator
      ? orchestratorCompleteness
      : thinking
        ? 0
        : 1;

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
        <p className="font-mono text-[11px] text-ink/50">{Math.round(progress * 100)}%</p>
      </div>

      {intro && turns.length === 0 && <p className="text-ink/60 text-pretty">{intro}</p>}

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
            <div
              key={t.id}
              className="flex flex-col gap-1 max-w-[85%] ml-auto items-end animate-slide-up"
            >
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

        {error && !thinking && (
          <div className="flex flex-col gap-3 animate-fade-in">
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
              <span className="font-semibold">Erreur : </span>
              {error}
            </div>
            <button
              onClick={handleRetry}
              className="self-start px-5 py-2 bg-ink text-background rounded-full text-xs font-semibold hover:bg-teal-dark transition-colors"
            >
              Réessayer
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {activeQuestionText && !thinking && !error && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2">
            {quickReplies.map((r) => (
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
