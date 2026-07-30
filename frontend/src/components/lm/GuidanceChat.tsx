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
import { ConversationHistory } from "@/components/lm/ConversationHistory";
import { Markdown } from "@/components/lm/Markdown";
import { RoadmapView, type Roadmap } from "@/components/lm/RoadmapView";
import { StatusCard } from "@/components/lm/StatusCard";
import {
  cacheDiagnosticResult,
  storeSessionId,
  type DiagnosticProfile,
  type UserProfile,
} from "@/lib/api";
import {
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      if (detail.roadmap) setSuggestions([]);
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

  async function send(text: string, action?: { kind: string; value: string }, turnIndex?: number) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    if (!action) setInput("");
    setTurns((prev) => [...prev, { id: nowId("u", prev.length), role: "user", text: message }]);
    if (action && turnIndex != null) {
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, optionPicked: action.value } : t)),
      );
    }
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
    localStorage.removeItem(SESSION_KEY);
    fetchSuggestions()
      .then((d) => setSuggestions(d.suggestions))
      .catch(() => {});
  };

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
            <div className="bg-white border border-border rounded-2xl p-6 animate-fade-in">
              <p className="text-sm text-ink/60 leading-relaxed">
                Décrivez votre activité avec vos mots — je construis votre situation au fil de la
                discussion, puis votre feuille de route. Aucun formulaire.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="px-4 py-2 bg-background border border-border rounded-full text-xs font-medium text-ink/70 hover:border-teal-dark hover:text-teal-dark transition-colors text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) =>
            turn.role === "assistant" ? (
              <div key={turn.id} className="space-y-3">
                <div className="flex flex-col gap-1 max-w-[85%] animate-slide-up">
                  <div className="p-4 bg-white border border-border rounded-2xl rounded-bl-none text-[15px] leading-relaxed text-ink shadow-sm">
                    {turn.error ? (
                      <span className="text-coral">Erreur : {turn.error}</span>
                    ) : (
                      <Markdown text={turn.text} />
                    )}
                  </div>
                  <span className="text-[10px] uppercase opacity-40 font-mono ml-1">Assistant</span>
                </div>

                {turn.options && (
                  <div className="max-w-[85%] rounded-2xl border border-teal-dark/30 bg-teal-light/10 p-4 animate-slide-up">
                    {turn.options.prompt && (
                      <p className="text-sm text-ink/70 mb-3">{turn.options.prompt}</p>
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
                            className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors disabled:opacity-40 ${
                              picked
                                ? "bg-ink text-background"
                                : "bg-white border border-border hover:border-teal-dark hover:text-teal-dark"
                            }`}
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
              <span className="font-mono text-xs">L&apos;assistant réfléchit…</span>
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

              <div className="rounded-2xl border border-teal-dark/30 bg-teal-dark/5 p-5 space-y-3 animate-slide-up">
                <button
                  onClick={openRoadmap}
                  className="px-5 py-2.5 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-colors"
                >
                  Ouvrir la vue détaillée →
                </button>
                {/* Suite du parcours : une fois immatriculé, on rejoint la vérification SIREN/avis
                    — le même écran que pour ceux qui avaient déjà un SIREN. */}
                <div className="pt-4 border-t border-teal-dark/20">
                  <p className="text-xs text-ink/50 leading-relaxed mb-3">
                    Une fois votre immatriculation obtenue, vérifiez votre SIREN et votre avis de
                    situation pour activer le suivi complet.
                  </p>
                  <button
                    onClick={() => void navigate({ to: "/onboarding/verification" })}
                    className="px-5 py-2.5 bg-white border border-teal-dark/40 text-teal-dark rounded-xl text-sm font-semibold hover:bg-teal-dark hover:text-background transition-colors"
                  >
                    J&apos;ai déjà mon SIREN → Vérification
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-coral font-mono animate-fade-in">{error}</p>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Réponses rapides contextuelles (décidées par le backend) + saisie libre.
            Une fois la feuille de route générée, il n'y a plus de question en attente : les
            suggestions n'ont plus de sens et ne doivent pas réapparaître (y compris en rouvrant
            une conversation dont le profil était déjà complet). */}
        <div className="shrink-0 mt-4 pt-4 border-t border-border space-y-3">
          {!empty && !roadmap && suggestions.length > 0 && !busy && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="px-4 py-2 bg-white border border-border rounded-full text-xs font-semibold hover:border-teal-dark hover:text-teal-dark transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Décrivez votre activité, ou posez votre question…"
              className="flex-1 px-5 py-3 bg-white border border-border rounded-full text-sm placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="px-5 py-3 bg-ink text-background rounded-full text-sm font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
            >
              Envoyer
            </button>
          </form>
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
