import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { fetchDiagnosticResult, type DiagnosticResult } from "@/lib/api-mock";

export const Route = createFileRoute("/onboarding/diagnostic/resultat")({
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

function ResultatPage() {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  useEffect(() => {
    fetchDiagnosticResult().then(setResult);
  }, []);

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

      {!result ? (
        <div className="text-ink/40 font-mono text-sm">Analyse en cours…</div>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-6">
            {/* 1. Fiche de situation */}
            <Card index="01" label="Fiche de situation">
              <dl className="space-y-4">
                <Row k="Activité" v={result.situation.activite} />
                <Row k="Revenus estimés" v={result.situation.revenus_estimes} />
                <Row k="Ancienneté" v={result.situation.anciennete} />
                <div>
                  <dt className="text-xs uppercase tracking-widest text-ink/40 mb-2">
                    Sources de revenus
                  </dt>
                  <dd className="flex flex-wrap gap-2">
                    {result.situation.sources.map((s) => (
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

            {/* 2. Statut actuel */}
            <Card index="02" label="Statut actuel">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-2.5 rounded-full bg-amber-fiscal" />
                <p className="text-lg font-semibold">{result.statut_actuel.label}</p>
              </div>
              <p className="text-ink/60 text-pretty leading-relaxed">
                {result.statut_actuel.description}
              </p>
            </Card>

            {/* 3. Plan de régularisation */}
            <Card index="03" label="Plan de régularisation" span="lg:col-span-2">
              <ol className="space-y-4">
                {result.plan.map((s) => (
                  <li key={s.step} className="flex gap-5">
                    <div className="shrink-0 size-10 rounded-full bg-background border border-border font-mono grid place-items-center text-sm font-medium">
                      {s.step.toString().padStart(2, "0")}
                    </div>
                    <div className="pt-1">
                      <p className="font-semibold">{s.title}</p>
                      <p className="text-sm text-ink/60 mt-1">{s.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          {/* 4. Régime recommandé — mis en avant */}
          <div className="mt-6 bg-teal-dark text-background rounded-2xl p-10 animate-slide-up relative overflow-hidden">
            <div className="absolute -top-24 -right-24 size-64 rounded-full bg-teal-light/30 blur-3xl" />
            <div className="relative">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] opacity-70 mb-4">
                04 · Régime recommandé
              </p>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter">
                    {result.regime_recommande.nom}
                  </h2>
                  <p className="mt-4 text-background/80 max-w-xl text-pretty leading-relaxed">
                    {result.regime_recommande.pourquoi}
                  </p>
                </div>
                <div className="shrink-0">
                  <p className="text-xs uppercase tracking-widest opacity-70">Plafond</p>
                  <p className="font-mono text-2xl font-medium mt-1">
                    {result.regime_recommande.plafond}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 flex justify-center">
            <Link
              to="/dashboard"
              className="px-10 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
            >
              Accéder à mon dashboard →
            </Link>
          </div>
        </>
      )}
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
      <div className="flex items-center gap-3 mb-6">
        <span className="font-mono text-[11px] text-ink/40">{index}</span>
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-widest text-ink/50 font-semibold">{label}</span>
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between items-baseline gap-6 border-b border-dashed border-border pb-3">
      <dt className="text-xs uppercase tracking-widest text-ink/40">{k}</dt>
      <dd className="font-semibold text-right">{v}</dd>
    </div>
  );
}
