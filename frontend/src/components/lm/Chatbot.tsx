import {
  ArrowRight,
  Bot,
  Check,
  Compass,
  Keyboard,
  Mic,
  MicOff,
  PartyPopper,
  RotateCcw,
  Send,
  User,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cacheDiagnosticResult,
  orchestratorTurn,
  storeSessionId,
  type UserProfile,
} from "@/lib/api";
import {
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

  /** Mode vocal uniquement : lit la question à voix haute, puis écoute la réponse — jamais
   * l'inverse, pour ne pas laisser le micro capter la voix de l'assistant. Le texte se révèle
   * progressivement (`onboundary`). Mode texte : affichage silencieux, pas de TTS.
   *
   * Si l'orchestrateur reformule EXACTEMENT la même question (réponse précédente non comprise),
   * on ne la relit pas une seconde fois à l'identique — mais on relance quand même l'écoute :
   * sans ce cas, le micro restait inactif après une réponse mal comprise. */
  const speakQuestion = (text: string) => {
    if (modeRef.current !== "vocal") return;
    if (lastSpokenRef.current === text || !speechSupported()) {
      startListening();
      return;
    }
    lastSpokenRef.current = text;
    setSpeaking(true);
    setRevealedLength(0);
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
    modeRef.current = next; // synchrone : startListening() / speakQuestion() ne doivent pas lire l'ancien mode
    if (next === "texte") {
      stopSpeaking();
      setSpeaking(false);
      setRevealedLength(null);
      stopListening();
      return;
    }
    // Passage en vocal : relire la question courante (si présente), puis écouter.
    if (orchestratorMessage && !thinking) {
      lastSpokenRef.current = null;
      speakQuestion(orchestratorMessage);
    }
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
    <div className="animate-fade-in mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-[200px] flex-1 items-center gap-5">
          <p className="rule-label inline-flex shrink-0 items-center gap-1.5 text-accent-ink">
            <Compass className="size-3" aria-hidden /> {eyebrow}
          </p>
          <div className="h-[3px] max-w-xs flex-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${Math.round(orchestratorCompleteness * 100)}%` }}
            />
          </div>
          <p className="num shrink-0 text-xs text-muted-foreground">
            {Math.round(orchestratorCompleteness * 100)}%
          </p>
        </div>

        {/* Assistant vocal : complément optionnel — masqué si le navigateur ne supporte pas la
            reconnaissance vocale. Mode Texte = silencieux ; mode Vocal = TTS + écoute auto. */}
        {canVoiceMode && (
          <div className="inline-flex shrink-0 rounded-full border border-border bg-card p-1 text-xs font-medium">
            {(
              [
                { value: "texte" as const, label: "Texte", icon: Keyboard },
                { value: "vocal" as const, label: "Vocal", icon: Mic },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => switchMode(option.value)}
                aria-pressed={mode === option.value}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-200",
                  mode === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <option.icon className="size-3" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {intro && turns.length === 0 && (
        <p className="text-pretty text-base text-muted-foreground">{intro}</p>
      )}

      {/* Mode vocal, état « l'assistant parle » : grand micro animé, avec sa commande d'arrêt.
          Aucun texte d'un bloc ici — seule la bulle de la question (ci-dessous) se révèle au
          rythme de la voix. */}
      {mode === "vocal" && speaking && (
        <div className="animate-fade-in flex flex-col items-center gap-2 py-2">
          <button
            type="button"
            onClick={stopSpeaking}
            title="Arrêter la lecture"
            aria-label="Arrêter la lecture à voix haute"
            className="relative grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform active:scale-95"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
            <span className="absolute -inset-2 animate-pulse rounded-full border-2 border-primary/30" />
            <Volume2 className="relative size-6" />
          </button>
          <span className="rule-label text-muted-foreground">L&apos;assistant parle…</span>
        </div>
      )}

      {/* États vocaux compacts : écoute avec transcription en direct, et réponse captée en
          attente d'envoi. Chacun reste distinct — jamais fondu dans un état « chargement ». */}
      {listening || voiceNotice || pendingVoiceAnswer ? (
        <div className="animate-fade-in flex flex-wrap items-center gap-2 text-xs">
          {listening && (
            <button
              type="button"
              onClick={stopListening}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1.5 text-destructive"
            >
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-destructive" />
              </span>
              <Mic className="size-3 shrink-0" />
              <span className="truncate">
                Je vous écoute{interim ? ` : « ${interim} »` : "…"}
              </span>
              <span className="shrink-0 underline">arrêter</span>
            </button>
          )}
          {pendingVoiceAnswer && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-muted-foreground">
              <Check className="size-3 shrink-0 text-success-ink" />
              <span className="truncate">« {pendingVoiceAnswer} »</span>
              <span className="shrink-0">— envoi dans un instant…</span>
            </span>
          )}
          {voiceNotice && !speaking && !listening && (
            <span className="text-muted-foreground">{voiceNotice}</span>
          )}
        </div>
      ) : null}

      {/* Cadre de conversation à hauteur fixe : seuls les messages défilent à l'intérieur — les
          suggestions et la saisie restent TOUJOURS visibles en bas, même en faisant défiler un
          long échange. */}
      <div className="flex h-[65vh] min-h-[440px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="chat-scroll flex-1 space-y-6 overflow-y-auto p-5">
        {turns.map((t, i) => {
          // Mode vocal, question en cours de lecture : le texte se révèle EN SYNC avec la voix
          // (voir speakQuestion/onboundary) plutôt que d'apparaître d'un bloc. En mode texte,
          // rien ne change (texte entier, immédiat, comme avant).
          const isRevealing =
            t.role === "assistant" && i === turns.length - 1 && mode === "vocal" && speaking && revealedLength !== null;
          const shown = isRevealing ? t.text.slice(0, Math.max(revealedLength!, 1)) : t.text;

          return t.role === "assistant" ? (
            <div key={t.id} className="animate-rise flex max-w-[85%] items-end gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "mb-4 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary",
                  isRevealing && "animate-pulse",
                )}
              >
                <Bot className="size-3.5" />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="rounded-2xl rounded-bl-none border border-border bg-card p-4 text-base leading-relaxed shadow-soft">
                  {shown}
                  {isRevealing && (
                    <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-foreground/40 align-middle" />
                  )}
                </div>
                <span className="rule-label ml-1 text-muted-foreground">
                  {t.time} — Assistant
                </span>
              </div>
            </div>
          ) : (
            <div
              key={t.id}
              className="animate-rise ml-auto flex max-w-[85%] items-end justify-end gap-2.5"
            >
              <div className="flex min-w-0 flex-col items-end gap-1.5">
                <div className="rounded-2xl rounded-br-none bg-primary p-4 text-base font-medium text-primary-foreground">
                  {t.text}
                </div>
                <span className="rule-label mr-1 text-muted-foreground">{t.time} — Vous</span>
              </div>
              <span
                aria-hidden
                className="mb-4 grid size-7 shrink-0 place-items-center rounded-full bg-ink text-ink-foreground"
              >
                <User className="size-3.5" />
              </span>
            </div>
          );
        })}

        {thinking && (
          <div className="animate-fade-in ml-10 flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
            <span className="rule-label">L&apos;assistant réfléchit…</span>
          </div>
        )}

        {error && !thinking && (
          <div className="animate-fade-in flex flex-col gap-3">
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive"
            >
              <span className="font-medium">Erreur : </span>
              {error}
            </div>
            <Button size="sm" onClick={handleRetry} className="self-start rounded-full">
              <RotateCcw /> Réessayer
            </Button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showComposer && (
        <div className="shrink-0 border-t border-border bg-card p-4 space-y-4">
          {roadmapReady ? (
            <div className="animate-seal space-y-4 rounded-2xl border border-accent/35 bg-accent/8 p-6">
              <p className="rule-label inline-flex items-center gap-1.5 text-accent-ink">
                <PartyPopper className="size-3" aria-hidden /> Feuille de route prête
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Votre diagnostic est terminé. Ouvrez le résultat pour voir le régime recommandé et
                le plan d&apos;étapes.
              </p>
              <Button
                type="button"
                size="lg"
                variant="accent"
                onClick={openRoadmap}
                className="w-full sm:w-auto"
              >
                {orchestratorQuickReplies[0] || "Voir ma feuille de route"} <ArrowRight />
              </Button>
            </div>
          ) : (
            <>
              {/* Les recommandations restent affichées en mode vocal aussi — elles n'apparaissent
                  qu'une fois la question entièrement lue (comme demandé : révélation du texte en
                  parallèle de la voix, PUIS les recommandations, PUIS le temps de répondre). En
                  mode texte, rien ne change : toujours affichées immédiatement, comme avant. */}
              {(mode !== "vocal" || !speaking) && (
              <div className="flex flex-wrap gap-2">
                {orchestratorQuickReplies.map((r, i) => (
                  <button
                    key={r}
                    onClick={() => handleAnswer(r)}
                    style={{ animationDelay: `${i * 60}ms` }}
                    className="suggestion-chip chip-stagger rounded-full px-4 py-2 text-xs font-medium"
                  >
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
                    aria-pressed={listening}
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full transition-all duration-200 active:scale-95",
                      listening
                        ? "bg-destructive text-destructive-foreground"
                        : "border border-border bg-card text-muted-foreground hover:border-ink hover:text-foreground",
                    )}
                  >
                    {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                )}
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ou tapez votre réponse librement…"
                  aria-label="Votre réponse"
                  className="flex-1 rounded-full border border-border bg-card px-5 py-2.5 text-sm transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-ink focus:outline-none"
                />
                <Button type="submit" variant="accent" className="rounded-full px-5">
                  <Send /> Envoyer
                </Button>
              </form>
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
