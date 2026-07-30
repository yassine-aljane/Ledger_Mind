import { useEffect, useRef, useState } from "react";
import {
  cacheDiagnosticResult,
  orchestratorTurn,
  storeSessionId,
  type UserProfile,
} from "@/lib/api";
import {
  isSpeaking,
  listenOnce,
  recognitionSupported,
  speak,
  speechSupported,
  stopSpeaking,
  type RecognitionHandle,
} from "@/lib/voice";

type Mode = "texte" | "vocal";

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

  // --- Assistant vocal (complément, jamais un prérequis) — API navigateur native uniquement.
  const [mode, setMode] = useState<Mode>("texte");
  const modeRef = useRef<Mode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // Révélation du texte de la question EN SYNC avec la voix (mode vocal uniquement) — null = texte
  // affiché intégralement (mode texte, ou lecture terminée) ; un nombre = position atteinte par
  // la synthèse vocale, pour un effet "machine à écrire" calé sur la voix, pas sur une minuterie.
  const [revealedLength, setRevealedLength] = useState<number | null>(null);
  // Réponse vocale captée mais pas encore écrite dans le chat — laisse "quelques secondes" avant
  // de l'envoyer, comme demandé, plutôt que de l'afficher/soumettre instantanément.
  const [pendingVoiceAnswer, setPendingVoiceAnswer] = useState<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<RecognitionHandle | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  // Détecté après montage seulement (jamais pendant le rendu serveur) : évite un décalage
  // d'hydratation entre le HTML serveur (pas de `window`) et le premier rendu client.
  const [canVoiceMode, setCanVoiceMode] = useState(false);
  useEffect(() => {
    setCanVoiceMode(recognitionSupported());
  }, []);

  /** `force` : passe outre le mode courant — le bouton micro doit rester utilisable à la main sur
   * CHAQUE question, même en mode texte (le déclenchement AUTOMATIQUE après lecture, lui, reste
   * réservé au mode vocal, plus bas). */
  const startListening = (force = false) => {
    if ((!force && modeRef.current !== "vocal") || listening) return;
    setVoiceNotice(null);
    setInterim("");
    const handle = listenOnce({
      onInterim: setInterim,
      onFinal: (text) => {
        setListening(false);
        setInterim("");
        // « Il attend quelques secondes pour que la réponse soit écrite dans le chat » : on ne
        // soumet pas tout de suite — on montre d'abord ce qui a été compris, puis on l'envoie.
        setPendingVoiceAnswer(text);
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          setPendingVoiceAnswer(null);
          handleAnswer(text);
        }, 1800);
      },
      onError: (message) => {
        setListening(false);
        setInterim("");
        setVoiceNotice(message);
      },
      onEnd: () => setListening(false),
    });
    if (handle) {
      recognitionRef.current = handle;
      setListening(true);
    }
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  };

  /** Lit la question à voix haute (les deux modes lisent) ; en mode vocal, écoute la réponse
   * juste après — jamais l'inverse, pour ne pas laisser le micro capter la voix de l'assistant.
   * En mode vocal, le texte de la question se révèle progressivement, calé sur la voix
   * (`onboundary`) plutôt qu'affiché d'un bloc — en mode texte, rien ne change (texte entier
   * immédiat, comme avant).
   *
   * Si l'orchestrateur reformule EXACTEMENT la même question (réponse précédente non comprise),
   * on ne la relit pas une seconde fois à l'identique — mais on relance quand même l'écoute en
   * mode vocal : sans ce cas, le micro restait inactif après une réponse mal comprise, donnant
   * l'impression que l'assistant "ignore" l'utilisateur au lieu de laisser reparler. */
  const speakQuestion = (text: string) => {
    if (lastSpokenRef.current === text || !speechSupported()) {
      if (modeRef.current === "vocal") startListening();
      return;
    }
    lastSpokenRef.current = text;
    setSpeaking(true);
    setRevealedLength(modeRef.current === "vocal" ? 0 : null);
    speak(
      text,
      () => {
        setSpeaking(false);
        setRevealedLength(null);
        if (modeRef.current === "vocal") startListening();
      },
      (charIndex) => {
        if (modeRef.current === "vocal") setRevealedLength(charIndex);
      },
    );
  };

  useEffect(() => {
    if (orchestratorMessage && !thinking) speakQuestion(orchestratorMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestratorMessage, thinking]);

  useEffect(() => {
    // Nettoyage : ne laisse jamais une lecture, une écoute ou un envoi différé tourner après
    // démontage/changement de page.
    return () => {
      stopSpeaking();
      recognitionRef.current?.stop();
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    modeRef.current = next; // synchrone : startListening() ci-dessous ne doit pas lire l'ancien mode
    if (next === "vocal" && orchestratorMessage && !isSpeaking() && !listening) {
      startListening();
    }
    if (next === "texte") stopListening();
  };

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
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6 flex-1 min-w-[200px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark inline-flex items-center gap-1.5 shrink-0">
            <span aria-hidden>🧭</span> {eyebrow}
          </p>
          <div className="flex-1 h-[3px] bg-border rounded-full overflow-hidden max-w-xs">
            <div
              className="h-full bg-teal-dark transition-all duration-500 ease-out"
              style={{ width: `${Math.round(orchestratorCompleteness * 100)}%` }}
            />
          </div>
          <p className="font-mono text-[11px] text-ink/50 shrink-0">
            {Math.round(orchestratorCompleteness * 100)}%
          </p>
        </div>

        {/* Assistant vocal : complément optionnel, jamais un prérequis — masqué si le navigateur
            ne supporte pas la reconnaissance vocale (dégradation propre, texte reste la voie
            principale). La lecture à voix haute des questions (TTS), elle, fonctionne dans les
            deux modes tant que le navigateur la supporte. */}
        {canVoiceMode && (
          <div className="inline-flex p-1 bg-white border border-border rounded-full text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => switchMode("texte")}
              aria-pressed={mode === "texte"}
              className={`px-3 py-1.5 rounded-full transition-all duration-200 inline-flex items-center gap-1.5 ${
                mode === "texte" ? "bg-ink text-background" : "text-ink/60 hover:text-ink"
              }`}
            >
              ⌨️ Texte
            </button>
            <button
              type="button"
              onClick={() => switchMode("vocal")}
              aria-pressed={mode === "vocal"}
              className={`px-3 py-1.5 rounded-full transition-all duration-200 inline-flex items-center gap-1.5 ${
                mode === "vocal" ? "bg-ink text-background" : "text-ink/60 hover:text-ink"
              }`}
            >
              🎙️ Vocal
            </button>
          </div>
        )}
      </div>

      {intro && turns.length === 0 && <p className="text-ink/60 text-pretty text-[17px]">{intro}</p>}

      {/* Mode vocal : grand micro animé pendant que l'assistant parle — pas de texte affiché
          d'un bloc ici, seule la bulle de la question (ci-dessous) se révèle progressivement. */}
      {mode === "vocal" && speaking && (
        <div className="flex flex-col items-center gap-2 py-2 animate-fade-in">
          <button
            type="button"
            onClick={stopSpeaking}
            title="Arrêter la lecture"
            className="relative size-16 rounded-full bg-teal-dark text-background grid place-items-center text-2xl shadow-lg transition-transform active:scale-95"
          >
            <span className="absolute inset-0 rounded-full bg-teal-dark/40 animate-ping" />
            <span className="absolute inset-[-8px] rounded-full border-2 border-teal-dark/30 animate-pulse" />
            <span className="relative">🔊</span>
          </button>
          <span className="text-[11px] font-mono uppercase tracking-widest text-ink/40">
            L&apos;assistant parle…
          </span>
        </div>
      )}

      {(mode === "texte" && speaking) || listening || voiceNotice || pendingVoiceAnswer ? (
        <div className="flex items-center gap-2 text-xs font-mono animate-fade-in flex-wrap">
          {mode === "texte" && speaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-dark/10 text-teal-dark hover:bg-teal-dark/20 transition-colors duration-200"
            >
              🔊 Lecture en cours… <span className="underline">arrêter</span>
            </button>
          )}
          {listening && (
            <button
              type="button"
              onClick={stopListening}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-coral/10 text-coral"
            >
              <span className="relative flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-coral opacity-60" />
                <span className="relative inline-flex rounded-full size-2 bg-coral" />
              </span>
              🎙️ Je vous écoute{interim ? ` : « ${interim} »` : "…"} <span className="underline">arrêter</span>
            </button>
          )}
          {pendingVoiceAnswer && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ink/5 text-ink/60">
              <span className="size-1.5 rounded-full bg-ink/40 animate-pulse" />
              « {pendingVoiceAnswer} » — envoi dans un instant…
            </span>
          )}
          {voiceNotice && !speaking && !listening && (
            <span className="text-ink/40">{voiceNotice}</span>
          )}
        </div>
      ) : null}

      {/* Cadre de conversation à hauteur fixe : seuls les messages défilent à l'intérieur — les
          suggestions et la saisie restent TOUJOURS visibles en bas, même en faisant défiler un
          long échange. */}
      <div className="flex flex-col border border-border rounded-2xl bg-white shadow-sm overflow-hidden h-[65vh] min-h-[440px]">
      <div className="chat-scroll flex-1 overflow-y-auto p-5 space-y-6">
        {turns.map((t, i) => {
          // Mode vocal, question en cours de lecture : le texte se révèle EN SYNC avec la voix
          // (voir speakQuestion/onboundary) plutôt que d'apparaître d'un bloc. En mode texte,
          // rien ne change (texte entier, immédiat, comme avant).
          const isRevealing =
            t.role === "assistant" && i === turns.length - 1 && mode === "vocal" && speaking && revealedLength !== null;
          const shown = isRevealing ? t.text.slice(0, Math.max(revealedLength!, 1)) : t.text;

          return t.role === "assistant" ? (
            <div key={t.id} className="flex items-end gap-2.5 max-w-[85%] animate-slide-up">
              <span
                aria-hidden
                className={`shrink-0 size-8 rounded-full bg-teal-dark/10 text-teal-dark grid place-items-center text-sm mb-4 ${
                  isRevealing ? "animate-pulse" : ""
                }`}
              >
                🤖
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="p-4 bg-white border border-border rounded-2xl rounded-bl-none text-[17px] leading-relaxed text-ink shadow-sm">
                  {shown}
                  {isRevealing && <span className="inline-block w-[2px] h-[1em] bg-ink/40 ml-0.5 align-middle animate-pulse" />}
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
                <div className="p-4 bg-teal-dark text-background rounded-2xl rounded-br-none text-[17px] font-medium">
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
          );
        })}

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
        <div className="shrink-0 border-t border-border bg-white p-4 space-y-4">
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
              {/* Les recommandations restent affichées en mode vocal aussi — elles n'apparaissent
                  qu'une fois la question entièrement lue (comme demandé : révélation du texte en
                  parallèle de la voix, PUIS les recommandations, PUIS le temps de répondre). En
                  mode texte, rien ne change : toujours affichées immédiatement, comme avant. */}
              {(mode !== "vocal" || !speaking) && (
              <div className="flex flex-wrap gap-2 animate-fade-in">
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
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAnswer(input);
                }}
                className="flex gap-2"
              >
                {/* Le micro reste disponible sur CHAQUE question, quel que soit le mode — le
                    mode "Vocal" ne fait qu'automatiser lecture + écoute ; ici, on permet de
                    répondre à la voix ponctuellement même en mode texte. */}
                {canVoiceMode && (
                  <button
                    type="button"
                    onClick={() => (listening ? stopListening() : startListening(true))}
                    title={listening ? "Arrêter le micro" : "Parler ma réponse"}
                    aria-label={listening ? "Arrêter le micro" : "Parler ma réponse"}
                    className={`shrink-0 size-11 rounded-full grid place-items-center text-lg transition-all duration-200 active:scale-95 ${
                      listening
                        ? "bg-coral text-background"
                        : "bg-white border border-border hover:border-teal-dark"
                    }`}
                  >
                    🎙️
                  </button>
                )}
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ou tapez votre réponse librement…"
                  className="flex-1 px-5 py-3 bg-white border border-border rounded-full text-base placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors duration-200"
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
    </div>
  );
}
