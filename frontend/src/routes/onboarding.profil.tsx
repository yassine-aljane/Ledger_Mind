import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Chatbot, type ChatTurn } from "@/components/lm/Chatbot";
import {
  getStoredSessionId,
  fetchUserProfile,
  orchestratorTurn,
  type UserProfile,
} from "@/lib/api";

export const Route = createFileRoute("/onboarding/profil")({
  head: () => ({
    meta: [
      { title: "Votre profil — LedgerMind" },
      { name: "description", content: "Quelques questions pour personnaliser votre suivi fiscal." },
      { property: "og:title", content: "Votre profil — LedgerMind" },
      {
        property: "og:description",
        content: "Quelques questions pour personnaliser votre suivi fiscal.",
      },
    ],
  }),
  component: ProfilPage,
});

function isIntakeComplete(profile: UserProfile): boolean {
  const questionsDone =
    profile.activity_types.length > 0 &&
    profile.main_activity_commercial !== null &&
    profile.has_secondary_activity !== null &&
    (profile.has_secondary_activity !== true || profile.secondary_activity_types.length > 0) &&
    profile.revenue_sources.length > 0 &&
    profile.international_clients !== null &&
    profile.currencies.length > 0 &&
    profile.estimated_monthly_revenue !== null &&
    profile.estimated_annual_revenue !== null &&
    profile.revenue_variability !== null &&
    profile.invoices_already_issued !== null &&
    profile.has_recurring_contracts !== null &&
    profile.in_kind_gifts !== null &&
    profile.first_income_date !== null;
  return questionsDone || profile.tax_category !== null || profile.fiscal_classification_status === "requires_expert";
}

function ProfilPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [doneTranscript, setDoneTranscript] = useState<ChatTurn[] | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState<string | undefined>();
  const [initialQuickReplies, setInitialQuickReplies] = useState<string[]>([]);
  const navigate = useNavigate();
  const routerState = useRouterState({ select: (s) => s.location.state }) as {
    initialQuestion?: string;
    initialQuickReplies?: string[];
  } | undefined;

  useEffect(() => {
    const id = getStoredSessionId();
    if (!id) {
      navigate({ to: "/onboarding" });
      return;
    }
    setSessionId(id);

    if (routerState?.initialQuestion) {
      setInitialQuestion(routerState.initialQuestion);
      setInitialQuickReplies(routerState.initialQuickReplies ?? []);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const p = await fetchUserProfile(id);
        if (isIntakeComplete(p)) {
          setProfile(p);
        } else {
          const turn = await orchestratorTurn(id, undefined);
          if (turn.ui_action === "ask_question" && turn.message) {
            setInitialQuestion(turn.message);
            setInitialQuickReplies(turn.quick_replies);
          } else if (turn.ui_action === "done") {
            setProfile(turn.profile);
          }
        }
      } catch (err) {
        console.error(err);
        navigate({ to: "/onboarding" });
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, routerState?.initialQuestion, routerState?.initialQuickReplies]);

  const handleFinish = (finalProfile: UserProfile, transcript: ChatTurn[]) => {
    setProfile(finalProfile);
    setDoneTranscript(transcript);
  };

  const updateProfileField = <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => {
    if (!profile) return;
    setProfile({ ...profile, [field]: value });
  };

  const handleRestart = () => {
    setProfile(null);
    setDoneTranscript(null);
    setEditingField(null);
    setInitialQuestion(undefined);
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
        <p className="text-ink/40 font-mono text-sm">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/onboarding/verification"
          className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink transition-colors duration-200"
        >
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      <div className="mt-12">
        {!profile ? (
          sessionId && (
            <Chatbot
              eyebrow="Construction du profil"
              orchestratorSessionId={sessionId}
              initialQuestion={initialQuestion}
              initialQuickReplies={initialQuickReplies}
              onOrchestratorFinish={handleFinish}
              intro="Quelques questions pour adapter LedgerMind à votre activité — le nombre dépend de votre situation."
            />
          )
        ) : (
          <div className="max-w-3xl mx-auto animate-slide-up space-y-8">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-2">
                  Validation Human-in-the-Loop
                </p>
                <button
                  onClick={handleRestart}
                  className="text-xs font-semibold text-ink/50 hover:text-coral transition-colors duration-200"
                >
                  ↺ Recommencer
                </button>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance inline-flex items-center gap-3">
                <span aria-hidden>✨</span>
                Vérifiez et ajustez <span className="italic font-normal">votre profil</span>.
              </h1>
              <p className="mt-3 text-ink/60 text-pretty">
                Ces informations proviennent de la vérification SIRET et de vos réponses. Vous pouvez
                modifier n'importe quelle donnée avant de valider.
              </p>
            </div>

            {(profile.denomination || profile.siret) && (
              <div className="bg-teal-dark/5 border border-teal-dark/20 rounded-2xl p-5">
                <p className="text-xs uppercase tracking-widest text-teal-dark font-semibold mb-2 inline-flex items-center gap-1.5">
                  <span aria-hidden>✅</span> Vérification SIRET
                </p>
                <p className="font-semibold">{profile.denomination ?? "—"}</p>
                <p className="font-mono text-sm text-ink/60 mt-1">{profile.siret}</p>
                {profile.tax_category && (
                  <p className="text-sm text-ink/70 mt-2">
                    Régime : {profile.recommended_regime} ({profile.tax_category}) — {profile.regime_plafond}
                  </p>
                )}
              </div>
            )}

            {profile.fiscal_classification_status === "requires_expert" && (
              <div className="rounded-2xl bg-coral/10 border border-coral/30 p-5">
                <p className="font-semibold text-coral">Classification bloquée — incohérence détectée</p>
                <p className="text-sm text-ink/70 mt-2">
                  {profile.fiscal_inconsistency_reason ??
                    "Contactez votre SIE ou demandez un rescrit fiscal via impots.gouv.fr."}
                </p>
              </div>
            )}

            {profile.activity_mismatch && profile.mismatches.length > 0 && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5">
                <p className="font-semibold text-amber-900">Écart d'activité détecté</p>
                {profile.mismatches.map((m, i) => (
                  <p key={i} className="text-sm text-amber-800 mt-1">{m.note}</p>
                ))}
              </div>
            )}

            <Section icon="🎯" title="Votre activité">
              <ProfileListField
                icon="🧩"
                label="Types d'activité"
                field="activity_types"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
                full
                render={(val) =>
                  (val as string[]).length > 0 ? (
                    (val as string[]).map((act, i) => (
                      <span key={i} className="px-2.5 py-1 bg-teal-dark/10 text-teal-dark rounded-md text-xs font-medium">
                        {act}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-ink/40">Non renseigné</span>
                  )
                }
              />
              <ProfileListField
                icon="📡"
                label="Sources de revenus / Plateformes"
                field="revenue_sources"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
                full
                render={(val) =>
                  (val as string[]).length > 0 ? (
                    (val as string[]).map((src, i) => (
                      <span key={i} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-medium">
                        {src}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-ink/40">Non renseigné</span>
                  )
                }
              />
            </Section>

            <Section icon="💶" title="Revenus & devises">
              <ProfileStringField
                icon="📅"
                label="Revenu mensuel estimé"
                field="estimated_monthly_revenue"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
              />
              <ProfileListField
                icon="💱"
                label="Devises de paiement"
                field="currencies"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
                render={(val) =>
                  (val as string[]).length > 0 ? (
                    (val as string[]).map((cur, i) => (
                      <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-mono font-medium">
                        {cur}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-ink/40">Non renseigné</span>
                  )
                }
              />
              <BoolField
                icon="🌍"
                label="Clients internationaux"
                value={profile.international_clients}
                onToggle={() =>
                  updateProfileField("international_clients", profile.international_clients === true ? false : true)
                }
                trueLabel="Oui (factures hors France / UE)"
                falseLabel="Non (France uniquement)"
              />
              <VariabilityField profile={profile} updateProfileField={updateProfileField} />
            </Section>

            <Section icon="📄" title="Facturation & contrats">
              <BoolField
                icon="🧾"
                label="Factures déjà émises"
                value={profile.invoices_already_issued}
                onToggle={() =>
                  updateProfileField("invoices_already_issued", profile.invoices_already_issued === true ? false : true)
                }
              />
              <BoolField
                icon="🔄"
                label="Contrats récurrents"
                value={profile.has_recurring_contracts}
                onToggle={() =>
                  updateProfileField("has_recurring_contracts", profile.has_recurring_contracts === true ? false : true)
                }
                trueLabel="Oui (abonnements/retainers)"
                falseLabel="Non (one-shot / par mission)"
              />
              <BoolField
                icon="🎁"
                label="Cadeaux & dotations en nature"
                value={profile.in_kind_gifts}
                onToggle={() =>
                  updateProfileField("in_kind_gifts", profile.in_kind_gifts === true ? false : true)
                }
                trueLabel="Oui (produits, voyages, dotations)"
              />
              <ProfileStringField
                icon="🚀"
                label="Début des premiers revenus"
                field="first_income_date"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
              />
            </Section>

            {doneTranscript && doneTranscript.length > 0 && (
              <div className="border border-border rounded-2xl bg-slate-50 p-4">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center justify-between w-full text-xs font-mono uppercase tracking-wider text-ink/60 hover:text-ink"
                >
                  <span>{showTranscript ? "Masquer" : "Voir"} l'historique ({doneTranscript.length} messages)</span>
                  <span>{showTranscript ? "▲" : "▼"}</span>
                </button>
                {showTranscript && (
                  <div className="mt-4 space-y-3 pt-3 border-t border-border/60 max-h-80 overflow-y-auto">
                    {doneTranscript.map((t) => (
                      <div
                        key={t.id}
                        className={`text-xs p-3 rounded-xl ${
                          t.role === "assistant"
                            ? "bg-white border border-border text-ink/80"
                            : "bg-teal-dark/10 text-teal-dark font-medium"
                        }`}
                      >
                        {t.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full px-8 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.98] text-center text-base shadow-md inline-flex items-center justify-center gap-2"
            >
              <span aria-hidden>🚀</span>
              Confirmer mon profil et continuer vers mon dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Petite tuile qui encadre chaque champ de la fiche — icône + libellé + valeur + action,
 * plus vivante qu'une simple ligne de liste tout en gardant la même logique d'édition. */
function FieldTile({
  icon,
  label,
  action,
  children,
}: {
  icon: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-background border border-border p-4 hover:border-teal-dark/40 hover:shadow-[0_4px_16px_-8px_rgba(22,36,31,0.15)] transition-all duration-200">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold uppercase tracking-wider text-ink/45 inline-flex items-center gap-1.5">
          <span aria-hidden className="text-base leading-none">{icon}</span>
          {label}
        </span>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** En-tête de section — regroupe des champs apparentés sous un même thème visuel. */
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-border rounded-2xl p-6 shadow-sm">
      <p className="font-semibold text-lg mb-4 inline-flex items-center gap-2">
        <span aria-hidden className="text-xl leading-none">{icon}</span>
        {title}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function ProfileListField<K extends keyof UserProfile>({
  icon,
  label,
  field,
  profile,
  editingField,
  setEditingField,
  updateProfileField,
  render,
  full = false,
}: {
  icon: string;
  label: string;
  field: K;
  profile: UserProfile;
  editingField: string | null;
  setEditingField: (f: string | null) => void;
  updateProfileField: <Key extends keyof UserProfile>(field: Key, value: UserProfile[Key]) => void;
  render: (val: UserProfile[K]) => React.ReactNode;
  full?: boolean;
}) {
  const val = profile[field];
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <FieldTile
        icon={icon}
        label={label}
        action={
          <button
            onClick={() => setEditingField(editingField === field ? null : (field as string))}
            className="text-xs font-semibold text-teal-dark hover:underline transition-colors duration-200 shrink-0"
          >
            {editingField === field ? "Valider" : "Modifier"}
          </button>
        }
      >
        {editingField === field ? (
          <input
            type="text"
            className="w-full text-sm p-2 border border-teal-dark rounded-lg input-boxed focus:outline-none"
            defaultValue={(val as string[]).join(", ")}
            onBlur={(e) => {
              const items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              updateProfileField(field, items as UserProfile[K]);
              setEditingField(null);
            }}
            autoFocus
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">{render(val)}</div>
        )}
      </FieldTile>
    </div>
  );
}

function ProfileStringField({
  icon,
  label,
  field,
  profile,
  editingField,
  setEditingField,
  updateProfileField,
}: {
  icon: string;
  label: string;
  field: "estimated_monthly_revenue" | "first_income_date";
  profile: UserProfile;
  editingField: string | null;
  setEditingField: (f: string | null) => void;
  updateProfileField: <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => void;
}) {
  const val = profile[field];
  return (
    <FieldTile
      icon={icon}
      label={label}
      action={
        <button
          onClick={() => setEditingField(editingField === field ? null : field)}
          className="text-xs font-semibold text-teal-dark hover:underline transition-colors duration-200 shrink-0"
        >
          {editingField === field ? "Valider" : "Modifier"}
        </button>
      }
    >
      {editingField === field ? (
        <input
          type="text"
          className="w-full text-sm p-2 border border-teal-dark rounded-lg input-boxed focus:outline-none"
          defaultValue={val ?? ""}
          onBlur={(e) => {
            updateProfileField(field, e.target.value || null);
            setEditingField(null);
          }}
          autoFocus
        />
      ) : (
        <p className="text-base font-semibold text-ink">
          {val || <span className="italic text-ink/40 font-normal">Non renseigné</span>}
        </p>
      )}
    </FieldTile>
  );
}

function BoolField({
  icon,
  label,
  value,
  onToggle,
  trueLabel = "Oui",
  falseLabel = "Non",
}: {
  icon: string;
  label: string;
  value: boolean | null;
  onToggle: () => void;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return (
    <FieldTile
      icon={icon}
      label={label}
      action={
        <button
          onClick={onToggle}
          className="text-xs font-semibold text-teal-dark hover:underline transition-colors duration-200 shrink-0"
        >
          Changer
        </button>
      }
    >
      <span className="text-base font-medium text-ink">
        {value === null ? "Non précisé" : value ? trueLabel : falseLabel}
      </span>
    </FieldTile>
  );
}

function VariabilityField({
  profile,
  updateProfileField,
}: {
  profile: UserProfile;
  updateProfileField: <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => void;
}) {
  return (
    <FieldTile icon="📈" label="Stabilité des revenus">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-base font-medium text-ink">
          {profile.revenue_variability === "stable"
            ? "Revenus stables"
            : profile.revenue_variability === "spiky"
            ? "Revenus irréguliers (pics de saisonnalité)"
            : "Non précisé"}
        </span>
        <div className="flex gap-2">
          {(["stable", "spiky"] as const).map((v) => (
            <button
              key={v}
              onClick={() => updateProfileField("revenue_variability", v)}
              className={`px-3 py-1 text-xs rounded-full border transition-all duration-200 active:scale-[0.95] ${
                profile.revenue_variability === v
                  ? "bg-teal-dark text-white border-teal-dark"
                  : "bg-white text-ink/60 border-border hover:border-teal-dark"
              }`}
            >
              {v === "stable" ? "Stables" : "Irréguliers"}
            </button>
          ))}
        </div>
      </div>
    </FieldTile>
  );
}
