<<<<<<< HEAD:src/routes/index.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
=======
import { createFileRoute, Link } from "@tanstack/react-router";
import { LogoutBubble } from "@/components/lm/AppShell";
>>>>>>> 432de77 (fix(onboarding): resolve agent infinite loop and add human-in-the-loop validation):frontend/src/routes/onboarding.index.tsx

export const Route = createFileRoute("/onboarding/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — commencez par l'essentiel" },
      {
        name: "description",
        content: "Freelance ou créateur ? En 2 minutes, on clarifie votre situation fiscale.",
      },
    ],
  }),
  component: Gate,
});

function useSessionGuard() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("lm.session")) {
        navigate({ to: "/auth", replace: true });
        return;
      }
    } catch {
      /* noop */
    }
    setReady(true);
  }, [navigate]);
  return ready;
}

function Gate() {
  const ready = useSessionGuard();
  if (!ready) return null;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 h-16 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-6 rounded-full bg-teal-dark" />
          <span className="font-semibold tracking-tight uppercase text-sm">LedgerMind</span>
        </Link>
        <LogoutBubble />
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <section className="max-w-2xl w-full text-center animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-6">
            Étape 01 · Statut administratif
          </p>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter text-balance leading-[1.02]">
            Commençons par <span className="italic font-normal">l'essentiel.</span>
          </h1>
          <p className="mt-8 text-lg text-ink/60 text-pretty max-w-lg mx-auto">
            Pour bien vous accompagner, on a besoin de connaître votre situation. Avez-vous déjà un{" "}
            <span className="font-semibold text-ink">numéro SIRET</span> ?
          </p>

          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/onboarding/verification"
              className="px-10 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
            >
              Oui, j'ai mon SIRET
            </Link>
            <Link
              to="/onboarding/diagnostic"
              className="px-10 py-5 bg-background border border-border rounded-xl font-semibold hover:border-ink transition-colors"
            >
              Non, pas encore
            </Link>
          </div>

          <p className="mt-16 text-xs text-ink/40 italic max-w-md mx-auto leading-relaxed">
            Le SIRET est le numéro qui identifie officiellement votre activité auprès de
            l'administration française. Vous l'avez si vous êtes déclaré en auto-entrepreneur,
            micro-entreprise ou tout autre statut.
          </p>
        </section>
      </main>

      <footer className="px-6 py-8 max-w-7xl mx-auto w-full">
        <p className="text-[11px] uppercase tracking-widest text-ink/40 font-mono">
          © 2026 LedgerMind — l'assistant fiscal qui parle humain.
        </p>
      </footer>
    </div>
  );
}
