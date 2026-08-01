/**
 * Espace conversationnel « pas encore immatriculé ».
 *
 * Trois éléments que l'utilisateur pilote :
 *   • les SUGGESTIONS d'ouverture, avant le premier message (puis les réponses rapides) ;
 *   • la FICHE DE STATUT adaptative, qui se remplit au fil de la discussion ;
 *   • l'HISTORIQUE des conversations, repris là où on s'était arrêté.
 *
 * Aucun cas fiscal n'est codé ici : les questions, les options cliquables et la feuille de route
 * viennent du backend déterministe. Le composant ne fait que les rendre.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, Send, ShieldCheck } from "lucide-react";
import { ConversationHistory } from "@/components/lm/ConversationHistory";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/lm/Markdown";
import { RoadmapView, type Roadmap } from "@/components/lm/RoadmapView";
import { StatusCard } from "@/components/lm/StatusCard";
import { SuggestionChips } from "@/components/lm/SuggestionChips";
import {
  cacheDiagnosticResult,
  storeSessionId,
  type DiagnosticProfile,
  type UserProfile,
} from "@/lib/api";
import {
  affinerSuggestions,
  deleteConversation,
  downloadRoadmapPdf,
  fetchConversation,
  fetchConversations,
  fetchGuidanceProfile,
  fetchSuggestions,
  patchGuidanceProfile,
  clearGuidanceProfileField,
  renameConversation,
  saveRoadmapState,
  sendGuidanceMessage,
  type ChatOptions,
  type ConversationSummary,
  type GuidanceProfile,
  type SuggestionsChamp,
} from "@/lib/guidance-api";

const SESSION_KEY = "ledgermind_guidance_session";

type Turn = {
  id: string;
  role: "assistant" | "user";
  text: string;
  options?: ChatOptions | null;
  optionPicked?: string;
  error?: string;
};

function nowId(prefix: string, n: number) {
  return `${prefix}-${n}-${Date.now()}`;
}

/** Profil minimal attendu par la page de résultat existante (branche SIREN). */
function toUserProfile(profil: GuidanceProfile, regime: string | null): UserProfile {
  return {
    siret: null, siren: null, denomination: null, legal_form: null,
    nature_juridique_code: null, is_entrepreneur_individuel: null, micro_eligible: null,
    registry_address: null, ape_code: null, activity_declared: null, creation_date: null,
    administrative_status: null, verification_status: "skipped",
    registry_document_required: null, registry_document_uploaded: false,
    registry_document_type: null, kbis_obtained: null, rcs_registered: null,
    registry_tax_base: null, sirene_document_uploaded: false,
    sirene_document_activity_label: null, sirene_document_address: null,
    sirene_document_registration_date: null,
    activity_types: profil.activite ? [profil.activite] : [],
    has_secondary_activity: null, secondary_activity_types: [],
    main_activity_commercial: null, revenue_sources: [], currencies: [],
    estimated_monthly_revenue: null,
    estimated_annual_revenue: profil.ca_estime != null ? `${Math.round(profil.ca_estime)} €` : null,
    revenue_variability: null, invoices_already_issued: null, first_income_date: null,
    has_recurring_contracts: null, in_kind_gifts: profil.recoit_cadeaux ?? null,
    international_clients: null, tax_category: null, tax_category_reason: null,
    recommended_regime: regime, regime_plafond: null,
    fiscal_classification_status: null, fiscal_inconsistency_reason: null,
    activity_mismatch: false, mismatches: [], compliance_alerts: [], recommended_actions: [],
  };
}

/** Le profil de guidance porte davantage d'informations que le UserProfile ci-dessus (CA
 * détaillé, devise, immatriculation…) — mis en cache comme DiagnosticProfile pour que la fiche
 * de situation de la page résultat les affiche, plutôt que de les perdre en cachant `null`. */
function toDiagnosticProfile(profil: GuidanceProfile): DiagnosticProfile {
  return {
    activite: profil.activite ?? null,
    ca_estime_annuel: profil.ca_estime ?? null,
    vend_produits: profil.vend_produits ?? null,
    recoit_cadeaux: profil.recoit_cadeaux ?? null,
    type_activite: null,
    premiere_annee: null,
    jours_activite: null,
    anciennete: null,
    ca_n_1_au_dessus_seuil: profil.ca_n_1_au_dessus_seuil ?? null,
    ca_n_2_au_dessus_seuil: null,
    situation_actuelle: profil.situation_actuelle ?? null,
    ca_prestations: profil.ca_prestations ?? null,
    ca_vente: profil.ca_vente ?? null,
    choix_parcours: profil.choix_parcours ?? null,
  };
}

export function GuidanceChat() {
  const navigate = useNavigate();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [profil, setProfil] = useState<GuidanceProfile>({});
  const [manquantes, setManquantes] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsChamp, setSuggestionsChamp] = useState<SuggestionsChamp | null>(null);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const [autreOuvert, setAutreOuvert] = useState(false);
  const [refiningChamp, setRefiningChamp] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshConversations = useCallback(() => {
    fetchConversations("guidance")
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
        })),
      );
      setProfil(detail.profil);
      setRoadmap(detail.roadmap as Roadmap | null);
      setChecked(detail.checked ?? {});
      setManquantes([]);
      setPickedLabel(null);
      setAutreOuvert(false);
      if (detail.roadmap) {
        setSuggestions([]);
        setSuggestionsChamp(null);
      } else {
        fetchSuggestions()
          .then((d) => setSuggestionsChamp(d.suggestions_champ))
          .catch(() => {});
      }
      const p = await fetchGuidanceProfile();
      setManquantes(p.manquantes);
    } catch (e) {
      if (!silent) setError("Impossible d'ouvrir cette conversation.");
      setSessionId(null);
    }
  }, []);

  // Chargement initial : historique, profil partagé, suggestions, dernière conversation.
  useEffect(() => {
    refreshConversations();
    fetchSuggestions()
      .then((d) => {
        setSuggestions(d.suggestions);
        setSuggestionsChamp(d.suggestions_champ);
        setProfil(d.profil);
      })
      .catch(() => {
        setSuggestions([
          "Je débute sur Instagram et je gagne de l'argent, par où commencer ?",
          "Je fais des vidéos YouTube, environ 3000 par mois",
          "Je veux créer mon activité de freelance",
        ]);
      });
    fetchGuidanceProfile()
      .then((d) => setManquantes(d.manquantes))
      .catch(() => {});
    const stored = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
    if (stored) void openConversation(stored, true);
  }, [openConversation, refreshConversations]);

  useEffect(() => {
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy, roadmap]);

  async function send(
    text: string,
    action?: { kind: string; value?: string; champ?: string; valeurs?: Record<string, unknown> },
    turnIndex?: number,
  ) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    if (!action) setInput("");
    setTurns((prev) => [...prev, { id: nowId("u", prev.length), role: "user", text: message }]);
    if (action && turnIndex != null && action.value) {
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, optionPicked: action.value } : t)),
      );
    }
    setAutreOuvert(false);
    setBusy(true);
    try {
      const data = await sendGuidanceMessage({
        session_id: sessionId,
        message,
        mode: "guidance",
        action: action ?? null,
      });
      const isNew = data.session_id !== sessionId;
      setSessionId(data.session_id);
      setProfil(data.profil);
      setSuggestions(data.suggestions ?? []);
      setSuggestionsChamp(data.suggestions_champ);
      setPickedLabel(null);
      setManquantes(data.profil_complet ? [] : manquantes);
      if (data.roadmap) setRoadmap(data.roadmap as Roadmap);
      setTurns((prev) => [
        ...prev,
        {
          id: nowId("a", prev.length),
          role: "assistant",
          text: data.reponse,
          options: data.options,
        },
      ]);
      // La fiche de statut affiche ce qui manque encore : on la resynchronise après chaque tour.
      fetchGuidanceProfile()
        .then((p) => setManquantes(p.manquantes))
        .catch(() => {});
      if (isNew) refreshConversations();

      if (data.roadmap) {
        const regime =
          (data.roadmap as any)?.bandeau?.titre ?? (data.roadmap as any)?.parcours ?? null;
        storeSessionId(data.session_id);
        cacheDiagnosticResult({
          session_id: data.session_id,
          phase: "diagnostic_roadmap",
          branch: "guidance",
          profile: toUserProfile(data.profil, regime),
          diagnostic_profile: toDiagnosticProfile(data.profil),
          roadmap: data.roadmap,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur réseau — réessayez.";
      setTurns((prev) => [
        ...prev,
        { id: nowId("a", prev.length), role: "assistant", text: "", error: msg },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const startNew = () => {
    setSessionId(null);
    setTurns([]);
    setRoadmap(null);
    setChecked({});
    setPickedLabel(null);
    setAutreOuvert(false);
    localStorage.removeItem(SESSION_KEY);
    fetchSuggestions()
      .then((d) => {
        setSuggestions(d.suggestions);
        setSuggestionsChamp(d.suggestions_champ);
      })
      .catch(() => {});
  };

  /** Clic sur une chip : réponse instantanée, aucune frappe — les valeurs sont déjà connues
   * (voir `reponse_champ` côté backend), donc aucune extraction sémantique n'est déclenchée. */
  const pickChip = (label: string, valeurs: Record<string, unknown>) => {
    if (!suggestionsChamp) return;
    setPickedLabel(label);
    void send(label, { kind: "reponse_champ", champ: suggestionsChamp.champ, valeurs });
  };

  /** « Autre » : la saisie libre reste toujours disponible — on ouvre/focus simplement le champ
   * déjà présent en bas de l'écran plutôt que de dupliquer un input. */
  const openAutre = () => {
    setPickedLabel("__autre__");
    setAutreOuvert(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Affinage progressif (chantier 1.2) : les chips déterministes s'affichent déjà ; pour un champ
  // OUVERT (ex. ca_estime), on tente en tâche de fond des suggestions plus contextualisées — sans
  // jamais bloquer ni remplacer l'affichage tant que la réponse n'est pas là.
  useEffect(() => {
    if (!suggestionsChamp?.ouvert) return;
    let annule = false;
    setRefiningChamp(true);
    affinerSuggestions(suggestionsChamp.champ)
      .then((d) => {
        if (annule || !d.suggestions) return;
        setSuggestionsChamp((prev) =>
          prev && prev.champ === suggestionsChamp.champ ? { ...prev, suggestions: d.suggestions! } : prev,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!annule) setRefiningChamp(false);
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsChamp?.champ]);

  const patchField = async (field: string, value: string | number | boolean) => {
    try {
      const d = await patchGuidanceProfile({ [field]: value } as Partial<GuidanceProfile>);
      setProfil(d.profil);
      setManquantes(d.manquantes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction impossible.");
    }
  };

  const clearField = async (field: string) => {
    try {
      const d = await clearGuidanceProfileField(field);
      setProfil(d.profil);
      setManquantes(d.manquantes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await send("Peux-tu me générer ma feuille de route ?");
    } finally {
      setGenerating(false);
    }
  };

  /** Coche optimiste puis persistance serveur : la progression survit au rechargement. */
  const toggleStep = (id: string) => {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    if (sessionId) void saveRoadmapState(sessionId, next).catch(() => {});
  };

  const resetChecks = () => {
    setChecked({});
    if (sessionId) void saveRoadmapState(sessionId, {}).catch(() => {});
  };

  const openRoadmap = () => {
    void navigate({
      to: "/onboarding/diagnostic/resultat",
      search: sessionId ? { session: sessionId } : {},
    });
  };

  const empty = turns.length === 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,280px)] gap-6 items-start">
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

      <div className="min-w-0 flex flex-col h-[75vh] min-h-[520px]">
        {/* Cadre de conversation à hauteur fixe : les anciens messages défilent ici, dans leur
            propre cadre, pendant que la saisie reste toujours visible en bas de l'écran — plutôt
            que de faire défiler toute la page à mesure que la discussion s'allonge. */}
        <div className="chat-scroll flex-1 overflow-y-auto pr-2 space-y-6">
          {empty && (
            <div className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Un clic suffit pour répondre — ou décrivez votre activité avec vos mots, la saisie
                libre reste toujours possible via « Autre ».
              </p>
              <div className="mt-4">
                {suggestionsChamp ? (
                  <SuggestionChips
                    structure={suggestionsChamp}
                    onPick={pickChip}
                    onAutre={openAutre}
                    picked={pickedLabel}
                    disabled={busy}
                    refining={refiningChamp}
                  />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => void send(s)}
                        style={{ animationDelay: `${i * 60}ms` }}
                        className="suggestion-chip chip-stagger rounded-full px-4 py-2 text-left text-xs font-medium"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {turns.map((turn, index) =>
            turn.role === "assistant" ? (
              <div key={turn.id} className="space-y-3">
                <div className="animate-rise flex max-w-[85%] flex-col gap-1.5">
                  <div className="rounded-2xl rounded-bl-none border border-border bg-card p-4 text-sm leading-relaxed shadow-soft">
                    {turn.error ? (
                      <span className="text-destructive">Erreur : {turn.error}</span>
                    ) : (
                      <Markdown text={turn.text} />
                    )}
                  </div>
                  <span className="rule-label ml-1 text-muted-foreground">Assistant</span>
                </div>

                {turn.options && (
                  <div className="animate-rise max-w-[85%] rounded-2xl border border-accent/35 bg-accent/8 p-4">
                    {turn.options.prompt && (
                      <p className="mb-3 text-sm text-muted-foreground">{turn.options.prompt}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {turn.options.choices.map((choice) => {
                        const picked = turn.optionPicked === choice.value;
                        return (
                          <button
                            key={choice.value}
                            disabled={busy || Boolean(turn.optionPicked)}
                            onClick={() =>
                              void send(choice.label, { kind: turn.options!.kind, value: choice.value }, index)
                            }
                            className={cn(
                              "rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100",
                              picked
                                ? "bg-primary text-primary-foreground"
                                : "border border-border bg-card hover:border-ink",
                            )}
                          >
                            {choice.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
              <span className="rule-label">L&apos;assistant réfléchit…</span>
            </div>
          )}

          {roadmap && (
            <div className="space-y-4">
              {/* La feuille de route se parcourt sans quitter la conversation : chaque étape
                  s'ouvre et se coche ici, la progression est persistée côté serveur. */}
              <RoadmapView
                roadmap={roadmap}
                checked={checked}
                onToggle={toggleStep}
                onReset={resetChecks}
                onPdf={() => downloadRoadmapPdf(sessionId, profil)}
              />

              <div className="animate-rise space-y-3 rounded-2xl border border-accent/35 bg-accent/8 p-5">
                <Button onClick={openRoadmap}>
                  Ouvrir la vue détaillée <ArrowRight />
                </Button>
                {/* Suite du parcours : une fois immatriculé, on rejoint la vérification SIREN/avis
                    — le même écran que pour ceux qui avaient déjà un SIREN. */}
                <div className="border-t border-accent/25 pt-4">
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    Une fois votre immatriculation obtenue, vérifiez votre SIREN et votre avis de
                    situation pour activer le suivi complet.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void navigate({ to: "/onboarding/verification" })}
                  >
                    <ShieldCheck /> J&apos;ai déjà mon SIREN
                  </Button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="animate-fade-in rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Réponses rapides contextuelles (décidées par le backend) + saisie libre.
            Une fois la feuille de route générée, il n'y a plus de question en attente : les
            suggestions n'ont plus de sens et ne doivent pas réapparaître (y compris en rouvrant
            une conversation dont le profil était déjà complet). */}
        <div className="shrink-0 mt-4 pt-4 border-t border-border space-y-3">
          {!empty && !roadmap && suggestionsChamp && !busy && (
            <SuggestionChips
              structure={suggestionsChamp}
              onPick={pickChip}
              onAutre={openAutre}
              picked={pickedLabel}
              disabled={busy}
              refining={refiningChamp}
            />
          )}
          {(autreOuvert || !suggestionsChamp || roadmap) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="animate-rise flex gap-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Décrivez votre activité, ou posez votre question…"
                aria-label="Votre message"
                className="flex-1 rounded-full border border-border bg-card px-5 py-2.5 text-sm transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-ink focus:outline-none"
              />
              <Button
                type="submit"
                variant="accent"
                className="rounded-full px-5"
                disabled={busy || !input.trim()}
              >
                <Send /> Envoyer
              </Button>
            </form>
          )}
        </div>
      </div>

      <StatusCard
        profil={profil}
        manquantes={manquantes}
        onPatch={(f, v) => void patchField(f, v)}
        onClear={(f) => void clearField(f)}
        onGenerate={() => void generate()}
        generating={generating}
      />
    </div>
  );
}
