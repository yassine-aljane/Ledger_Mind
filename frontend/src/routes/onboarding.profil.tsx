import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Chatbot, type ChatTurn } from "@/components/lm/Chatbot";
import { type InfluencerProfile } from "@/lib/api-mock";

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

function ProfilPage() {
  const [doneTranscript, setDoneTranscript] = useState<ChatTurn[] | null>(null);
  const [profile, setProfile] = useState<InfluencerProfile | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const navigate = useNavigate();

  const handleFinish = (finalProfile: InfluencerProfile, transcript: ChatTurn[]) => {
    setProfile(finalProfile);
    setDoneTranscript(transcript);
  };

  const updateProfileField = <K extends keyof InfluencerProfile>(
    field: K,
    value: InfluencerProfile[K]
  ) => {
    if (!profile) return;
    setProfile({
      ...profile,
      [field]: value,
    });
  };

  const handleRestart = () => {
    setProfile(null);
    setDoneTranscript(null);
    setEditingField(null);
  };

  return (
    <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/onboarding/verification"
          className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink"
        >
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      <div className="mt-12">
        {!profile ? (
          <Chatbot
            eyebrow="Construction du profil"
            onFinish={handleFinish}
            intro="Quelques questions pour adapter LedgerMind à votre activité — le nombre dépend de votre situation."
          />
        ) : (
          <div className="max-w-2xl mx-auto animate-slide-up space-y-8">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-2">
                  Validation Human-in-the-Loop
                </p>
                <button
                  onClick={handleRestart}
                  className="text-xs font-semibold text-ink/50 hover:text-coral transition-colors"
                >
                  ↺ Recommencer l'agent
                </button>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance">
                Vérifiez et ajustez <span className="italic font-normal">votre profil</span>.
              </h1>
              <p className="mt-3 text-ink/60 text-pretty">
                L'agent AI a extrait ces informations de vos réponses. Vous pouvez modifier n'importe quelle donnée avant de valider.
              </p>
            </div>

            {/* Profile Fields Review Card */}
            <div className="bg-white border border-border rounded-2xl divide-y divide-border shadow-sm">
              {/* Activity Types */}
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                    Types d'activité
                  </span>
                  {editingField === "activity_types" ? (
                    <input
                      type="text"
                      className="w-full text-sm p-2 border border-teal-dark rounded-lg focus:outline-none"
                      defaultValue={profile.activity_types.join(", ")}
                      onBlur={(e) => {
                        const val = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        updateProfileField("activity_types", val);
                        setEditingField(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {profile.activity_types.length > 0 ? (
                        profile.activity_types.map((act, i) => (
                          <span key={i} className="px-2.5 py-1 bg-teal-dark/10 text-teal-dark rounded-md text-xs font-medium">
                            {act}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm italic text-ink/40">Non renseigné</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === "activity_types" ? null : "activity_types")}
                  className="text-xs font-semibold text-teal-dark hover:underline self-start sm:self-center"
                >
                  {editingField === "activity_types" ? "Valider" : "Modifier"}
                </button>
              </div>

              {/* Revenue Sources */}
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                    Sources de revenus / Plateformes
                  </span>
                  {editingField === "revenue_sources" ? (
                    <input
                      type="text"
                      className="w-full text-sm p-2 border border-teal-dark rounded-lg focus:outline-none"
                      defaultValue={profile.revenue_sources.join(", ")}
                      onBlur={(e) => {
                        const val = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        updateProfileField("revenue_sources", val);
                        setEditingField(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {profile.revenue_sources.length > 0 ? (
                        profile.revenue_sources.map((src, i) => (
                          <span key={i} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-medium">
                            {src}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm italic text-ink/40">Non renseigné</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === "revenue_sources" ? null : "revenue_sources")}
                  className="text-xs font-semibold text-teal-dark hover:underline self-start sm:self-center"
                >
                  {editingField === "revenue_sources" ? "Valider" : "Modifier"}
                </button>
              </div>

              {/* Currencies */}
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                    Devises de paiement
                  </span>
                  {editingField === "currencies" ? (
                    <input
                      type="text"
                      className="w-full text-sm p-2 border border-teal-dark rounded-lg focus:outline-none"
                      defaultValue={profile.currencies.join(", ")}
                      onBlur={(e) => {
                        const val = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        updateProfileField("currencies", val);
                        setEditingField(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {profile.currencies.length > 0 ? (
                        profile.currencies.map((cur, i) => (
                          <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-mono font-medium">
                            {cur}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm italic text-ink/40">Non renseigné</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === "currencies" ? null : "currencies")}
                  className="text-xs font-semibold text-teal-dark hover:underline self-start sm:self-center"
                >
                  {editingField === "currencies" ? "Valider" : "Modifier"}
                </button>
              </div>

              {/* International Clients */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40 block">
                    Clients internationaux
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {profile.international_clients === null
                      ? "Non précisé"
                      : profile.international_clients
                      ? "Oui (factures hors France / UE)"
                      : "Non (France uniquement)"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    updateProfileField(
                      "international_clients",
                      profile.international_clients === true ? false : true
                    )
                  }
                  className="text-xs font-semibold text-teal-dark hover:underline"
                >
                  Changer ({profile.international_clients ? "Passer à Non" : "Passer à Oui"})
                </button>
              </div>

              {/* Estimated Monthly Revenue */}
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                    Revenu mensuel estimé
                  </span>
                  {editingField === "estimated_monthly_revenue" ? (
                    <input
                      type="text"
                      className="w-full text-sm p-2 border border-teal-dark rounded-lg focus:outline-none"
                      defaultValue={profile.estimated_monthly_revenue ?? ""}
                      onBlur={(e) => {
                        updateProfileField("estimated_monthly_revenue", e.target.value || null);
                        setEditingField(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm font-semibold text-ink">
                      {profile.estimated_monthly_revenue || <span className="italic text-ink/40 font-normal">Non renseigné</span>}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === "estimated_monthly_revenue" ? null : "estimated_monthly_revenue")}
                  className="text-xs font-semibold text-teal-dark hover:underline self-start sm:self-center"
                >
                  {editingField === "estimated_monthly_revenue" ? "Valider" : "Modifier"}
                </button>
              </div>

              {/* Revenue Variability */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40 block">
                    Stabilité des revenus
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {profile.revenue_variability === "stable"
                      ? "Revenus stables"
                      : profile.revenue_variability === "spiky"
                      ? "Revenus irréguliers (pics de saisonnalité)"
                      : "Non précisé"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateProfileField("revenue_variability", "stable")}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      profile.revenue_variability === "stable"
                        ? "bg-teal-dark text-white border-teal-dark"
                        : "bg-white text-ink/60 border-border hover:border-teal-dark"
                    }`}
                  >
                    Stables
                  </button>
                  <button
                    onClick={() => updateProfileField("revenue_variability", "spiky")}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      profile.revenue_variability === "spiky"
                        ? "bg-teal-dark text-white border-teal-dark"
                        : "bg-white text-ink/60 border-border hover:border-teal-dark"
                    }`}
                  >
                    Irréguliers
                  </button>
                </div>
              </div>

              {/* Invoices Already Issued */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40 block">
                    Factures déjà émises
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {profile.invoices_already_issued === null
                      ? "Non précisé"
                      : profile.invoices_already_issued
                      ? "Oui"
                      : "Non"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    updateProfileField(
                      "invoices_already_issued",
                      profile.invoices_already_issued === true ? false : true
                    )
                  }
                  className="text-xs font-semibold text-teal-dark hover:underline"
                >
                  Changer ({profile.invoices_already_issued ? "Non" : "Oui"})
                </button>
              </div>

              {/* Recurring Contracts */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40 block">
                    Contrats récurrents
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {profile.has_recurring_contracts === null
                      ? "Non précisé"
                      : profile.has_recurring_contracts
                      ? "Oui (abonnements/retainers)"
                      : "Non (one-shot / par mission)"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    updateProfileField(
                      "has_recurring_contracts",
                      profile.has_recurring_contracts === true ? false : true
                    )
                  }
                  className="text-xs font-semibold text-teal-dark hover:underline"
                >
                  Changer ({profile.has_recurring_contracts ? "Non" : "Oui"})
                </button>
              </div>

              {/* Gifts in Kind */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40 block">
                    Cadeaux & dotations en nature
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {profile.in_kind_gifts === null
                      ? "Non précisé"
                      : profile.in_kind_gifts
                      ? "Oui (produits, voyages, dotations)"
                      : "Non"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    updateProfileField(
                      "in_kind_gifts",
                      profile.in_kind_gifts === true ? false : true
                    )
                  }
                  className="text-xs font-semibold text-teal-dark hover:underline"
                >
                  Changer ({profile.in_kind_gifts ? "Non" : "Oui"})
                </button>
              </div>

              {/* First Income Date */}
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                    Début des premiers revenus
                  </span>
                  {editingField === "first_income_date" ? (
                    <input
                      type="text"
                      className="w-full text-sm p-2 border border-teal-dark rounded-lg focus:outline-none"
                      defaultValue={profile.first_income_date ?? ""}
                      onBlur={(e) => {
                        updateProfileField("first_income_date", e.target.value || null);
                        setEditingField(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm font-medium text-ink">
                      {profile.first_income_date || <span className="italic text-ink/40 font-normal">Non renseigné</span>}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === "first_income_date" ? null : "first_income_date")}
                  className="text-xs font-semibold text-teal-dark hover:underline self-start sm:self-center"
                >
                  {editingField === "first_income_date" ? "Valider" : "Modifier"}
                </button>
              </div>
            </div>

            {/* Conversation Transcript Accordion */}
            {doneTranscript && doneTranscript.length > 0 && (
              <div className="border border-border rounded-2xl bg-slate-50 p-4">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center justify-between w-full text-xs font-mono uppercase tracking-wider text-ink/60 hover:text-ink"
                >
                  <span>{showTranscript ? "Masquer" : "Voir"} l'historique complet de la discussion ({doneTranscript.length} messages)</span>
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
                        <span className="font-mono text-[10px] uppercase opacity-50 block mb-0.5">
                          {t.role === "assistant" ? "Assistant" : "Vous"} — {t.time}
                        </span>
                        {t.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full px-8 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors text-center text-base shadow-md"
            >
              Confirmer mon profil et continuer vers mon dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
