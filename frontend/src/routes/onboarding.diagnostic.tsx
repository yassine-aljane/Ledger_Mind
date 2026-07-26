import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Chatbot } from "@/components/lm/Chatbot";
import { nextDiagnosticQuestion } from "@/lib/api-mock";

export const Route = createFileRoute("/onboarding/diagnostic")({
  head: () => ({
    meta: [
      { title: "Diagnostic de régularisation — LedgerMind" },
      {
        name: "description",
        content: "Un diagnostic guidé pour clarifier votre situation, sans jugement.",
      },
      { property: "og:title", content: "Diagnostic de régularisation — LedgerMind" },
      {
        property: "og:description",
        content: "Un diagnostic guidé pour clarifier votre situation, sans jugement.",
      },
    ],
  }),
  component: DiagnosticPage,
});

function DiagnosticPage() {
  const [started, setStarted] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link to="/onboarding" className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink">
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      {!started ? (
        <section className="mt-16 max-w-2xl mx-auto text-center animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-6">
            Étape 02 · Diagnostic
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-balance">
            On va faire le point,{" "}
            <span className="italic font-normal">ensemble.</span>
          </h1>
          <p className="mt-8 text-lg text-ink/60 text-pretty">
            Aucun jugement, aucun jargon. Quelques questions simples pour comprendre où vous en
            êtes et vous proposer la meilleure marche à suivre.
          </p>

          <div className="mt-12 grid sm:grid-cols-3 gap-4 text-left">
            {[
              { n: "6", l: "questions rapides" },
              { n: "3 min", l: "de discussion" },
              { n: "4 résultats", l: "personnalisés" },
            ].map((s) => (
              <div key={s.l} className="bg-white border border-border rounded-2xl p-6">
                <p className="font-mono text-2xl font-medium text-teal-dark">{s.n}</p>
                <p className="text-sm text-ink/60 mt-1">{s.l}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStarted(true)}
            className="mt-12 px-10 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
          >
            Commencer le diagnostic
          </button>
        </section>
      ) : (
        <div className="mt-12">
          <Chatbot
            eyebrow="Diagnostic de régularisation"
            fetchNext={nextDiagnosticQuestion}
            onFinish={() => navigate({ to: "/onboarding/diagnostic/resultat" })}
          />
        </div>
      )}
    </div>
  );
}
