import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import { PremiumPagePlaceholder } from "@/components/lm/PremiumPagePlaceholder";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import {
  displayName,
  fetchMe,
  getStoredUser,
  isAuthed,
  type AuthUser,
  type BranchAgentContext,
} from "@/lib/auth";
import {
  fetchSessionDetail,
  getStoredSessionId,
  storeSessionId,
  type DiagnosticProfile,
  type SessionDetail,
} from "@/lib/api";

export const Route = createFileRoute("/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres — LedgerMind" },
      { name: "description", content: "Votre profil, vos préférences et vos accès." },
      { property: "og:title", content: "Paramètres — LedgerMind" },
      { property: "og:description", content: "Votre profil, vos préférences et vos accès." },
    ],
  }),
  component: ParametresPage,
});

function formatCa(diag: DiagnosticProfile | null, guidance: BranchAgentContext | undefined): string {
  if (diag?.ca_estime_annuel != null) {
    return `≈ ${Math.round(diag.ca_estime_annuel).toLocaleString("fr-FR")} € / an`;
  }
  const profile = guidance?.profile as { estimated_annual_revenue?: string } | null | undefined;
  if (profile?.estimated_annual_revenue) return profile.estimated_annual_revenue;
  return "—";
}

function ParametresPage() {
  if (usePlan() === "free") return <PremiumPagePlaceholder kind="parametres" />;
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me);

        const sid =
          getStoredSessionId() ||
          me.agent_context.guidance.last_session_id ||
          me.agent_context.intake.last_session_id;
        if (!sid) return;
        storeSessionId(sid);
        const d = await fetchSessionDetail(sid);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) navigate({ to: "/auth", replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const intake = user?.agent_context.intake;
  const guidance = user?.agent_context.guidance;
  const diag =
    detail?.diagnostic_profile ??
    ((guidance?.diagnostic_profile as DiagnosticProfile | null | undefined) ?? null);
  const roadmap = (detail?.roadmap ?? guidance?.roadmap) as
    | { bandeau?: { titre?: string; texte?: string }; etapes?: unknown[] }
    | null
    | undefined;

  const regime =
    detail?.profile.recommended_regime ||
    guidance?.recommended_regime ||
    roadmap?.bandeau?.titre ||
    null;
  const regimeTexte =
    roadmap?.bandeau?.texte ||
    "Votre feuille de route a été construite à partir du diagnostic.";
  const etapesCount =
    detail?.profile.recommended_actions.length ||
    (Array.isArray(roadmap?.etapes) ? roadmap!.etapes!.length : 0) ||
    0;

  const hasGuidance = Boolean(guidance?.last_session_id || regime);

  const fields = [
    { l: "Identité", v: displayName(user) },
    { l: "Email", v: user?.email ?? "—" },
    { l: "Notifications", v: "Actives" },
    {
      l: "Session intake",
      v: intake?.phase ?? "—",
      mono: true,
    },
  ];

  return (
    <AppShell>
      <PageHeader eyebrow="Paramètres" title="Votre profil" />

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 grid sm:grid-cols-2 gap-6">
          {fields.map((f) => (
            <div key={f.l} className="bg-white border border-border rounded-2xl p-6 card-hover">
              <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-3">
                {f.l}
              </p>
              <p className={`${"mono" in f && f.mono ? "font-mono" : ""} text-lg font-medium`}>
                {f.v}
              </p>
            </div>
          ))}
        </div>

        <div className="lg:col-span-5">
          {hasGuidance ? (
            <div className="rounded-2xl border border-border bg-white p-8 space-y-6 animate-slide-up card-hover">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
                Synthèse guidance
              </p>
              <div>
                <p className="text-xs uppercase tracking-widest text-ink/40">Régime</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {regime ?? "À préciser"}
                </p>
                <p className="mt-3 text-sm text-ink/60 leading-relaxed">{regimeTexte}</p>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/40">Activité</dt>
                  <dd className="font-medium text-right">
                    {diag?.activite ||
                      detail?.profile.activity_types?.[0] ||
                      "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/40">CA estimé</dt>
                  <dd className="font-medium text-right">{formatCa(diag, guidance)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/40">Situation</dt>
                  <dd className="font-medium text-right">
                    {diag?.situation_actuelle || "Non immatriculé"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink/40">Étapes</dt>
                  <dd className="font-medium text-right">{etapesCount || "—"}</dd>
                </div>
              </dl>
              <Link
                to="/onboarding/diagnostic/resultat"
                className="block w-full text-center px-6 py-3 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
              >
                Ouvrir la feuille de route →
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-sm text-ink/50 text-center">
              Aucune synthèse guidance pour l&apos;instant. Complétez le diagnostic sans SIRET
              pour l&apos;afficher ici.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
