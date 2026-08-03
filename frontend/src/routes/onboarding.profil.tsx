import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import {
  CalendarDays,
  Coins,
  Euro,
  FileText,
  Gift,
  Globe,
  Puzzle,
  ReceiptText,
  RefreshCw,
  Rocket,
  Rss,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { cn } from "@/lib/utils";
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
  component: ProfilRoute,
});

function ProfilRoute() {
  return (
    <AccessGate feature="onboarding">
      <ProfilPage />
    </AccessGate>
  );
}

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
        <p className="text-muted-foreground font-mono text-sm">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/onboarding/verification"
          className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-ink transition-colors duration-200"
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
                  className="text-xs font-semibold text-muted-foreground hover:text-destructive transition-colors duration-200"
                >
                  ↺ Recommencer
                </button>
              </div>
              <h1 className="text-4xl md:text-5xl font-medium text-balance inline-flex items-center gap-3">
                <span aria-hidden>✨</span>
                Vérifiez et ajustez <span className="italic font-normal">votre profil</span>.
              </h1>
              <p className="mt-3 text-muted-foreground text-pretty">
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
                <p className="font-mono text-sm text-muted-foreground mt-1">{profile.siret}</p>
                {profile.tax_category && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Régime : {profile.recommended_regime} ({profile.tax_category}) — {profile.regime_plafond}
                  </p>
                )}
              </div>
            )}

            {profile.fiscal_classification_status === "requires_expert" && (
              <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-5">
                <p className="font-semibold text-destructive">Classification bloquée — incohérence détectée</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {profile.fiscal_inconsistency_reason ??
                    "Contactez votre SIE ou demandez un rescrit fiscal via impots.gouv.fr."}
                </p>
              </div>
            )}

            {profile.activity_mismatch && profile.mismatches.length > 0 && (
              <div className="rounded-2xl border border-warning/40 bg-warning/12 p-5">
                <p className="font-medium text-warning-ink">Écart d'activité détecté</p>
                {profile.mismatches.map((m, i) => (
                  <p key={i} className="mt-1 text-sm text-muted-foreground">{m.note}</p>
                ))}
              </div>
            )}

            <Section icon={Target} title="Votre activité">
              <ProfileListField
                icon={Puzzle}
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
                      <span key={i} className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {act}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-muted-foreground">Non renseigné</span>
                  )
                }
              />
              <ProfileListField
                icon={Rss}
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
                      <span key={i} className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                        {src}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-muted-foreground">Non renseigné</span>
                  )
                }
              />
            </Section>

            <Section icon={Euro} title="Revenus & devises">
              <ProfileStringField
                icon={CalendarDays}
                label="Revenu mensuel estimé"
                field="estimated_monthly_revenue"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
              />
              <ProfileListField
                icon={Coins}
                label="Devises de paiement"
                field="currencies"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
                render={(val) =>
                  (val as string[]).length > 0 ? (
                    (val as string[]).map((cur, i) => (
                      <span key={i} className="num rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success-ink">
                        {cur}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-muted-foreground">Non renseigné</span>
                  )
                }
              />
              <BoolField
                icon={Globe}
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

            <Section icon={FileText} title="Facturation & contrats">
              <BoolField
                icon={ReceiptText}
                label="Factures déjà émises"
                value={profile.invoices_already_issued}
                onToggle={() =>
                  updateProfileField("invoices_already_issued", profile.invoices_already_issued === true ? false : true)
                }
              />
              <BoolField
                icon={RefreshCw}
                label="Contrats récurrents"
                value={profile.has_recurring_contracts}
                onToggle={() =>
                  updateProfileField("has_recurring_contracts", profile.has_recurring_contracts === true ? false : true)
                }
                trueLabel="Oui (abonnements/retainers)"
                falseLabel="Non (one-shot / par mission)"
              />
              <BoolField
                icon={Gift}
                label="Cadeaux & dotations en nature"
                value={profile.in_kind_gifts}
                onToggle={() =>
                  updateProfileField("in_kind_gifts", profile.in_kind_gifts === true ? false : true)
                }
                trueLabel="Oui (produits, voyages, dotations)"
              />
              <ProfileStringField
                icon={Rocket}
                label="Début des premiers revenus"
                field="first_income_date"
                profile={profile}
                editingField={editingField}
                setEditingField={setEditingField}
                updateProfileField={updateProfileField}
              />
            </Section>

            {doneTranscript && doneTranscript.length > 0 && (
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center justify-between w-full text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-ink"
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
                            ? "bg-card border border-border text-muted-foreground"
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
              className="w-full px-8 py-5 bg-ink text-ink-foreground rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.98] text-center text-base shadow-md inline-flex items-center justify-center gap-2"
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
  icon: Icon,
  label,
  action,
  children,
}: {
  icon: LucideIcon;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card-hover rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="rule-label inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          {label}
        </span>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** En-tête de section — regroupe des champs apparentés sous un même thème visuel. */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <h2 className="mb-5 inline-flex items-center gap-2.5 text-lg">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary">
          <Icon aria-hidden className="size-4" />
        </span>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
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
  icon: LucideIcon;
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
            className="shrink-0 text-xs font-medium text-primary transition-colors duration-200 hover:underline"
          >
            {editingField === field ? "Valider" : "Modifier"}
          </button>
        }
      >
        {editingField === field ? (
          <input
            type="text"
            className="input-boxed w-full rounded-lg border border-ink bg-card p-2 text-sm focus:outline-none"
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
  icon: LucideIcon;
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
          className="shrink-0 text-xs font-medium text-primary transition-colors duration-200 hover:underline"
        >
          {editingField === field ? "Valider" : "Modifier"}
        </button>
      }
    >
      {editingField === field ? (
        <input
          type="text"
          className="input-boxed w-full rounded-lg border border-ink bg-card p-2 text-sm focus:outline-none"
          defaultValue={val ?? ""}
          onBlur={(e) => {
            updateProfileField(field, e.target.value || null);
            setEditingField(null);
          }}
          autoFocus
        />
      ) : (
        <p className="text-sm font-medium">
          {val || <span className="font-normal italic text-muted-foreground">Non renseigné</span>}
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
  icon: LucideIcon;
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
          className="shrink-0 text-xs font-medium text-primary transition-colors duration-200 hover:underline"
        >
          Changer
        </button>
      }
    >
      <span className="text-sm font-medium">
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
    <FieldTile icon={TrendingUp} label="Stabilité des revenus">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-medium">
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
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-[0.95]",
                profile.revenue_variability === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-ink",
              )}
            >
              {v === "stable" ? "Stables" : "Irréguliers"}
            </button>
          ))}
        </div>
      </div>
    </FieldTile>
  );
}
