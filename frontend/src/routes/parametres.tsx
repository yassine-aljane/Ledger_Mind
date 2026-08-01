import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PremiumGate } from "@/components/lm/PremiumPagePlaceholder";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
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
  component: ParametresRoute,
});

function ParametresRoute() {
  return (
    <PremiumGate kind="parametres">
      <ParametresPage />
    </PremiumGate>
  );
}

function formatCa(diag: DiagnosticProfile | null, guidance: BranchAgentContext | undefined): string {
  if (diag?.ca_estime_annuel != null) {
    return `≈ ${Math.round(diag.ca_estime_annuel).toLocaleString("fr-FR")} € / an`;
  }
  const profile = guidance?.profile as { estimated_annual_revenue?: string } | null | undefined;
  if (profile?.estimated_annual_revenue) return profile.estimated_annual_revenue;
  return "—";
}

function ParametresPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const { theme, setTheme } = useTheme();

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

      <div className="grid items-start gap-8 lg:grid-cols-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:col-span-7">
          {fields.map((f) => (
            <div
              key={f.l}
              className="card-hover animate-rise rounded-2xl border border-border bg-card p-5 shadow-soft"
            >
              <p className="rule-label mb-3 text-muted-foreground">{f.l}</p>
              <p className={cn("text-base font-medium", "mono" in f && f.mono && "num")}>{f.v}</p>
            </div>
          ))}

          <div className="animate-rise rounded-2xl border border-border bg-card p-5 shadow-soft sm:col-span-2">
            <p className="rule-label mb-3 text-muted-foreground">Apparence</p>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Thème {theme === "dark" ? "sombre" : "clair"} — appliqué à tout l&apos;espace.
              </p>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("light")}
                >
                  <Sun /> Clair
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("dark")}
                >
                  <Moon /> Sombre
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          {hasGuidance ? (
            <div className="card-hover animate-rise space-y-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
              <p className="rule-label text-accent-ink">Synthèse guidance</p>
              <div>
                <p className="rule-label text-muted-foreground">Régime</p>
                <p className="mt-2 text-2xl">{regime ?? "À préciser"}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{regimeTexte}</p>
              </div>
              <dl className="space-y-3 text-sm">
                {[
                  {
                    dt: "Activité",
                    dd: diag?.activite || detail?.profile.activity_types?.[0] || "—",
                  },
                  { dt: "CA estimé", dd: formatCa(diag, guidance), num: true },
                  { dt: "Situation", dd: diag?.situation_actuelle || "Non immatriculé" },
                  { dt: "Étapes", dd: String(etapesCount || "—"), num: true },
                ].map((row) => (
                  <div key={row.dt} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{row.dt}</dt>
                    <dd className={cn("text-right font-medium", row.num && "num")}>{row.dd}</dd>
                  </div>
                ))}
              </dl>
              <Button asChild className="w-full">
                <Link to="/onboarding/diagnostic/resultat">
                  Ouvrir la feuille de route <ArrowRight />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Aucune synthèse guidance pour l&apos;instant. Complétez le diagnostic sans SIRET pour
              l&apos;afficher ici.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
