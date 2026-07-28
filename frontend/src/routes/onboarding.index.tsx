import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { supabase } from "@/integrations/supabase/client";

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
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
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
            Avez-vous déjà un statut administratif ou un numéro SIREN / SIRET enregistré pour votre activité ?
          </p>

          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <Link
              to="/onboarding/verification"
              className="group p-8 bg-white border border-border rounded-2xl text-left hover:border-teal-dark hover:shadow-lg transition-all"
            >
              <div className="size-10 rounded-full bg-teal-dark/10 text-teal-dark font-mono text-sm font-semibold grid place-items-center group-hover:bg-teal-dark group-hover:text-background transition-colors">
                A
              </div>
              <p className="mt-6 font-semibold text-lg">Oui, j'ai un SIREN / SIRET</p>
              <p className="mt-2 text-sm text-ink/60 leading-relaxed">
                Vérification automatique auprès de l'INSEE et du RNE en 30 secondes.
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-teal-dark">
                Vérifier mon numéro →
              </span>
            </Link>

            <Link
              to="/onboarding/diagnostic"
              className="group p-8 bg-white border border-border rounded-2xl text-left hover:border-teal-dark hover:shadow-lg transition-all"
            >
              <div className="size-10 rounded-full bg-amber-fiscal/20 text-amber-900 font-mono text-sm font-semibold grid place-items-center group-hover:bg-amber-fiscal group-hover:text-amber-950 transition-colors">
                B
              </div>
              <p className="mt-6 font-semibold text-lg">Non / Je ne sais pas</p>
              <p className="mt-2 text-sm text-ink/60 leading-relaxed">
                Diagnostic guidé pour devenir légal et actif — sans créer de profil fiscal.
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-teal-dark">
                Lancer le diagnostic →
              </span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
