import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import {
  fetchSessionDetail,
  getStoredSessionId,
  loadCachedDiagnosticResult,
  type DiagnosticProfile,
  type SessionDetail,
  type UserProfile,
} from "@/lib/api";

export const Route = createFileRoute("/onboarding/diagnostic/resultat")({
  validateSearch: (search: Record<string, unknown>): { session?: string } => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Votre diagnostic — LedgerMind" },
      {
        name: "description",
        content: "Fiche de situation, statut, plan de régularisation et régime recommandé.",
      },
      { property: "og:title", content: "Votre diagnostic — LedgerMind" },
      {
        property: "og:description",
        content: "Fiche de situation, statut, plan de régularisation et régime recommandé.",
      },
    ],
  }),
  component: ResultatPage,
});

type RoadmapEtape = {
  id?: string;
  titre?: string;
  texte?: string;
  detail?: string;
  title?: string;
  description?: string;
};

type RoadmapBandeau = {
  titre?: string;
  texte?: string;
  type?: string;
};

function formatCa(n: number | null | undefined): string {
  if (n == null) return "Non renseigné";
  return `≈ ${Math.round(n).toLocaleString("fr-FR")} € / an`;
}

function situationFrom(
  diag: DiagnosticProfile | null,
  profile: UserProfile,
): { activite: string; revenus: string; anciennete: string; sources: string[] } {
  const sources: string[] = [];
  if (diag?.vend_produits) sources.push("Vente de produits");
  if (diag?.recoit_cadeaux) sources.push("Cadeaux / dotations");
  if (diag?.activite) sources.push(diag.activite);
  const activityTypes = profile.activity_types ?? [];
  if (sources.length === 0 && activityTypes.length) {
    sources.push(...activityTypes);
  }
  return {
    activite: diag?.activite || activityTypes[0] || "Activité créative / freelance",
    revenus: formatCa(diag?.ca_estime_annuel) || profile.estimated_annual_revenue || "Non renseigné",
    anciennete: diag?.anciennete || "Non renseignée",
    sources: sources.length ? sources : ["À préciser"],
  };
}

function etapeDescription(e: RoadmapEtape): string {
  return e.detail || e.texte || e.description || "";
}

function ResultatPage() {
  const { session: sessionFromUrl } = Route.useSearch();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = loadCachedDiagnosticResult();
    if (cached?.roadmap || (cached?.profile.recommended_actions?.length ?? 0) > 0) {
      setDetail(cached);
    }

    const id = sessionFromUrl || getStoredSessionId() || cached?.session_id || null;
    if (!id) {
      if (!cached) {
        setError("Aucune session de diagnostic trouvée. Recommencez le diagnostic.");
      }
      return;
    }

    fetchSessionDetail(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => {
        if (cached) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement");
      });
  }, [sessionFromUrl]);

  const roadmap = detail?.roadmap as {
    bandeau?: RoadmapBandeau;
    etapes?: RoadmapEtape[];
    parcours?: string;
    seuil_micro?: number;
    seuils_profil?: { seuil?: number }[];
  } | null | undefined;
  const situation = detail
    ? situationFrom(detail.diagnostic_profile, detail.profile)
    : null;
  const plan =
    detail?.profile.recommended_actions?.length
      ? detail.profile.recommended_actions
      : (roadmap?.etapes || []).map((e, i) => ({
          step: i + 1,
          title: e.titre || e.title || `Étape ${i + 1}`,
          description: etapeDescription(e),
        }));
  const regimeNom =
    detail?.profile.recommended_regime ||
    roadmap?.bandeau?.titre ||
    "Régime à préciser";
  const regimePourquoi =
    roadmap?.bandeau?.texte ||
    "Votre feuille de route a été construite à partir de votre situation déclarée.";
  const seuilFromProfile = roadmap?.seuils_profil?.[0]?.seuil;
  const plafond =
    detail?.profile.regime_plafond ||
    (roadmap?.seuil_micro != null
      ? `${Math.round(roadmap.seuil_micro).toLocaleString("fr-FR")} €`
      : seuilFromProfile != null
        ? `${Math.round(seuilFromProfile).toLocaleString("fr-FR")} €`
        : "—");

  return (
    <div className="min-h-screen px-6 py-16 max-w-6xl mx-auto">
      <div className="flex justify-end mb-6">
        <LogoutBubble />
      </div>
      <header className="mb-16 animate-slide-up">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-4">
          Résultat de votre diagnostic
        </p>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-balance max-w-3xl">
          Voici votre situation, <span className="italic font-normal">clairement.</span>
        </h1>
      </header>

      {error && !detail && (
        <div className="space-y-4">
          <div className="text-coral font-mono text-sm">{error}</div>
          <Link
            to="/onboarding/diagnostic"
            className="inline-block text-sm font-semibold text-teal-dark hover:underline"
          >
            ← Recommencer le diagnostic
          </Link>
        </div>
      )}
      {!detail && !error ? (
        <div className="text-ink/40 font-mono text-sm">Analyse en cours…</div>
      ) : detail && situation ? (
        <>
          <div className="grid lg:grid-cols-2 gap-6">
            <Card index="01" label="Fiche de situation">
              <dl className="space-y-4">
                <Row k="Activité" v={situation.activite} />
                <Row k="Revenus estimés" v={situation.revenus} />
                <Row k="Ancienneté" v={situation.anciennete} />
                <div>
                  <dt className="text-xs uppercase tracking-widest text-ink/40 mb-2">
                    Sources / nature
                  </dt>
                  <dd className="flex flex-wrap gap-2">
                    {situation.sources.map((s) => (
                      <span
                        key={s}
                        className="px-3 py-1 bg-background border border-border rounded-full text-xs font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card index="02" label="Statut actuel">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-2.5 rounded-full bg-amber-fiscal" />
                <p className="text-lg font-semibold">
                  {detail.diagnostic_profile?.situation_actuelle
                    ? `Situation : ${detail.diagnostic_profile.situation_actuelle}`
                    : "Non immatriculé à ce jour"}
                </p>
              </div>
              <p className="text-ink/60 text-pretty leading-relaxed">
                Votre activité n&apos;est pas encore rattachée à un SIREN. Ce n&apos;est pas grave —
                la feuille de route ci-dessous détaille les étapes pour régulariser.
              </p>
            </Card>

            <Card index="03" label="Plan de régularisation" span="lg:col-span-2">
              {plan.length === 0 ? (
                <p className="text-ink/50 text-sm">Aucune étape disponible pour le moment.</p>
              ) : (
                <ol className="space-y-4">
                  {plan.map((s) => (
                    <li key={s.step} className="flex gap-5">
                      <div className="shrink-0 size-10 rounded-full bg-background border border-border font-mono grid place-items-center text-sm font-medium">
                        {s.step.toString().padStart(2, "0")}
                      </div>
                      <div className="pt-1">
                        <p className="font-semibold">{s.title}</p>
                        {s.description ? (
                          <p className="text-sm text-ink/60 mt-1">{s.description}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="mt-6 bg-teal-dark text-background rounded-2xl p-10 animate-slide-up relative overflow-hidden">
            <div className="absolute -top-24 -right-24 size-64 rounded-full bg-teal-light/30 blur-3xl" />
            <div className="relative">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] opacity-70 mb-4">
                04 · Régime recommandé
              </p>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter">
                    {regimeNom}
                  </h2>
                  <p className="mt-4 text-background/80 max-w-xl text-pretty leading-relaxed">
                    {regimePourquoi}
                  </p>
                </div>
                <div className="shrink-0">
                  <p className="text-xs uppercase tracking-widest opacity-70">Plafond</p>
                  <p className="font-mono text-2xl font-medium mt-1">{plafond}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 flex justify-center gap-4">
            <Link
              to="/onboarding/diagnostic"
              className="px-8 py-4 border border-border rounded-xl font-semibold hover:border-teal-dark transition-colors"
            >
              Refaire le diagnostic
            </Link>
            <Link
              to="/dashboard"
              className="px-10 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
            >
              Accéder à mon dashboard →
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Card({
  index,
  label,
  children,
  span = "",
}: {
  index: string;
  label: string;
  children: React.ReactNode;
  span?: string;
}) {
  return (
    <section
      className={`bg-white border border-border rounded-2xl p-8 animate-slide-up ${span}`}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-6">
        {index} · {label}
      </p>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-ink/40">{k}</dt>
      <dd className="mt-1 font-medium">{v}</dd>
    </div>
  );
}
