import { useEffect, useRef, useState } from "react";
import {
  cacheDiagnosticResult,
  orchestratorTurn,
  storeSessionId,
  type UserProfile,
} from "@/lib/api";

export type ChatTurn = {
  id: string;
  role: "assistant" | "user";
  text: string;
  time: string;
};

function nowTime() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function Chatbot({
  eyebrow = "Diagnostic",
  intro,
  orchestratorSessionId,
  onOrchestratorFinish,
  initialQuestion,
  initialQuickReplies,
}: {
  eyebrow?: string;
  intro?: string;
  orchestratorSessionId: string;
  onOrchestratorFinish?: (profile: UserProfile, transcript: ChatTurn[]) => void;
  initialQuestion?: string;
  initialQuickReplies?: string[];
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [orchestratorMessage, setOrchestratorMessage] = useState<string | null>(null);
  const [orchestratorQuickReplies, setOrchestratorQuickReplies] = useState<string[]>([]);
  const [orchestratorCompleteness, setOrchestratorCompleteness] = useState(0);
  const [thinking, setThinking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [roadmapReady, setRoadmapReady] = useState(false);
  const finishedProfileRef = useRef<UserProfile | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const lastCallRef = useRef<{ question: string | null; answer: string | null }>({
    question: null,
    answer: null,
  });

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, thinking, error, roadmapReady]);

  async function runOrchestratorTurn(lastQuestion: string | null, lastAnswer: string | null) {
    setError(null);
    setThinking(true);
    lastCallRef.current = { question: lastQuestion, answer: lastAnswer };

    try {
      const result = await orchestratorTurn(orchestratorSessionId, lastAnswer ?? undefined);
      setThinking(false);
      if (result.session_id) storeSessionId(result.session_id);

      if (result.ui_action === "show_roadmap") {
        if (result.message) {
          setTurns((prev) => [
            ...prev,
            {
              id: `a-${prev.length}`,
              role: "assistant",
              text: result.message!,
              time: nowTime(),
            },
          ]);
        }
        finishedProfileRef.current = result.profile;
        cacheDiagnosticResult({
          session_id: result.session_id,
          phase: result.phase,
          branch: "guidance",
          profile: result.profile,
          diagnostic_profile: result.diagnostic_profile ?? null,
          roadmap: result.roadmap ?? null,
        });
        setOrchestratorCompleteness(1);
        setRoadmapReady(true);
        setOrchestratorMessage(result.message ?? "Votre feuille de route est prête.");
        setOrchestratorQuickReplies(
          result.quick_replies.length > 0
            ? result.quick_replies
            : ["Voir ma feuille de route"],
        );
        return;
      }

      if (
        result.ui_action === "done" ||
        result.ui_action === "show_compliance" ||
        result.ui_action === "show_tax_result" ||
        result.ui_action === "requires_expert"
      ) {
        if (result.message) {
          setTurns((prev) => [
            ...prev,
            {
              id: `a-${prev.length}`,
              role: "assistant",
              text: result.message!,
              time: nowTime(),
            },
          ]);
        }
        setOrchestratorMessage(null);
        setOrchestratorQuickReplies([]);
        setOrchestratorCompleteness(1);
        onOrchestratorFinish?.(result.profile, turns);
        return;
      }

      if (result.ui_action === "ask_question" && result.message) {
        setOrchestratorMessage(result.message);
        setOrchestratorQuickReplies(result.quick_replies);
        if (typeof result.profile_completeness === "number") {
          setOrchestratorCompleteness(result.profile_completeness);
        }

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
        return;
      }

      // Unexpected response — don't leave the user without controls
      setError("Réponse inattendue du serveur. Réessayez.");
      if (lastQuestion) setOrchestratorMessage(lastQuestion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau — veuillez réessayer.";
      console.error("Orchestrator turn failed:", err);
      setThinking(false);
      setError(msg);
      if (lastQuestion) setOrchestratorMessage(lastQuestion);
    }
  }

  const openRoadmap = () => {
    const profile = finishedProfileRef.current;
    if (profile) {
      onOrchestratorFinish?.(profile, turns);
      return;
    }
    onOrchestratorFinish?.(
      {
        siret: null,
        siren: null,
        denomination: null,
        legal_form: null,
        nature_juridique_code: null,
        is_entrepreneur_individuel: null,
        micro_eligible: null,
        registry_address: null,
        ape_code: null,
        activity_declared: null,
        creation_date: null,
        administrative_status: null,
        verification_status: "skipped",
        registry_document_required: null,
        registry_document_uploaded: false,
        registry_document_type: null,
        kbis_obtained: null,
        rcs_registered: null,
        registry_tax_base: null,
        sirene_document_uploaded: false,
        sirene_document_activity_label: null,
        sirene_document_address: null,
        sirene_document_registration_date: null,
        activity_types: [],
        has_secondary_activity: null,
        secondary_activity_types: [],
        main_activity_commercial: null,
        revenue_sources: [],
        currencies: [],
        estimated_monthly_revenue: null,
        estimated_annual_revenue: null,
        revenue_variability: null,
        invoices_already_issued: null,
        first_income_date: null,
        has_recurring_contracts: null,
        in_kind_gifts: null,
        international_clients: null,
        tax_category: null,
        tax_category_reason: null,
        recommended_regime: null,
        regime_plafond: null,
        fiscal_classification_status: null,
        fiscal_inconsistency_reason: null,
        activity_mismatch: false,
        mismatches: [],
        compliance_alerts: [],
        recommended_actions: [],
      },
      turns,
    );
  };

  const handleAnswer = (text: string) => {
    if (!text.trim()) return;
    const answer = text.trim();

    if (roadmapReady) {
      openRoadmap();
      return;
    }

    const question = orchestratorMessage;
    if (!question) return;
    setTurns((prev) => [
      ...prev,
      { id: `u-${prev.length}`, role: "user", text: answer, time: nowTime() },
    ]);
    setInput("");
    setOrchestratorMessage(null);
    void runOrchestratorTurn(question, answer);
  };

  const handleRetry = () => {
    const { question, answer } = lastCallRef.current;
    void runOrchestratorTurn(question, answer);
  };

  const showComposer = Boolean(orchestratorMessage) && !thinking && !error;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div className="flex items-center justify-between gap-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark inline-flex items-center gap-1.5">
          <span aria-hidden>🧭</span> {eyebrow}
        </p>
        <div className="flex-1 h-[3px] bg-border rounded-full overflow-hidden max-w-xs">
          <div
            className="h-full bg-teal-dark transition-all duration-500 ease-out"
            style={{ width: `${Math.round(orchestratorCompleteness * 100)}%` }}
          />
        </div>
        <p className="font-mono text-[11px] text-ink/50">
          {Math.round(orchestratorCompleteness * 100)}%
        </p>
      </div>

      {intro && turns.length === 0 && <p className="text-ink/60 text-pretty">{intro}</p>}

      <div className="space-y-6 min-h-[360px]">
        {turns.map((t) =>
          t.role === "assistant" ? (
            <div key={t.id} className="flex items-end gap-2.5 max-w-[85%] animate-slide-up">
              <span
                aria-hidden
                className="shrink-0 size-8 rounded-full bg-teal-dark/10 text-teal-dark grid place-items-center text-sm mb-4"
              >
                🤖
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="p-4 bg-white border border-border rounded-2xl rounded-bl-none text-[15px] leading-relaxed text-ink shadow-sm">
                  {t.text}
                </div>
                <span className="text-[10px] uppercase opacity-40 font-mono ml-1">
                  {t.time} — Assistant
                </span>
              </div>
            </div>
          ) : (
            <div
              key={t.id}
              className="flex items-end justify-end gap-2.5 max-w-[85%] ml-auto animate-slide-up"
            >
              <div className="flex flex-col gap-1 items-end min-w-0">
                <div className="p-4 bg-teal-dark text-background rounded-2xl rounded-br-none text-[15px] font-medium">
                  {t.text}
                </div>
                <span className="text-[10px] uppercase opacity-40 font-mono mr-1">
                  {t.time} — Vous
                </span>
              </div>
              <span
                aria-hidden
                className="shrink-0 size-8 rounded-full bg-ink text-background grid place-items-center text-sm mb-4"
              >
                🙂
              </span>
            </div>
          ),
        )}

        {thinking && (
          <div className="flex items-center gap-2 text-ink/40 text-sm animate-fade-in ml-[42px]">
            <span className="size-1.5 rounded-full bg-teal-dark animate-pulse" />
            <span className="size-1.5 rounded-full bg-teal-dark animate-pulse [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-teal-dark animate-pulse [animation-delay:300ms]" />
            <span className="font-mono text-xs">L&apos;assistant réfléchit…</span>
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
              className="self-start px-5 py-2 bg-ink text-background rounded-full text-xs font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
            >
              Réessayer
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showComposer && (
        <div className="space-y-4 pt-2">
          {roadmapReady ? (
            <div className="rounded-2xl border border-teal-dark/30 bg-teal-dark/5 p-6 space-y-4 animate-slide-up">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark inline-flex items-center gap-1.5">
                <span aria-hidden>🎉</span> Feuille de route prête
              </p>
              <p className="text-sm text-ink/70 leading-relaxed">
                Votre diagnostic est terminé. Ouvrez le résultat pour voir le régime recommandé
                et le plan d&apos;étapes.
              </p>
              <button
                type="button"
                onClick={openRoadmap}
                className="w-full sm:w-auto px-8 py-3.5 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
              >
                {orchestratorQuickReplies[0] || "Voir ma feuille de route"} →
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {orchestratorQuickReplies.map((r) => (
                  <button
                    key={r}
                    onClick={() => handleAnswer(r)}
                    className="px-4 py-2 bg-white border border-border rounded-full text-xs font-semibold hover:border-teal-dark hover:text-teal-dark transition-all duration-200 active:scale-[0.96] inline-flex items-center gap-1.5"
                  >
                    <span aria-hidden className="opacity-50">💬</span>
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
                  className="flex-1 px-5 py-3 bg-white border border-border rounded-full text-sm placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors duration-200"
                />
                <button
                  type="submit"
                  className="px-5 py-3 bg-ink text-background rounded-full text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
                >
                  Envoyer
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
