import { createFileRoute, Link } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { LogoutBubble } from "@/components/lm/AppShell";

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
  component: OnboardingRoute,
});

function OnboardingRoute() {
  return (
    <AccessGate feature="onboarding">
      <Gate />
    </AccessGate>
  );
}

function Gate() {
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
          <h1 className="text-5xl md:text-7xl font-medium text-balance leading-[1.02]">
            Commençons par <span className="italic font-normal">l'essentiel.</span>
          </h1>
          <p className="mt-8 text-lg text-muted-foreground text-pretty max-w-lg mx-auto">
            Avez-vous déjà un statut administratif ou un numéro SIREN / SIRET enregistré pour votre activité ?
          </p>

          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <Link
              to="/onboarding/verification"
              className="group p-8 bg-card border border-border rounded-2xl text-left hover:border-teal-dark hover:shadow-lg transition-all duration-200 active:scale-[0.99]"
            >
              <div className="size-10 rounded-full bg-teal-dark/10 text-teal-dark font-mono text-sm font-semibold grid place-items-center group-hover:bg-teal-dark group-hover:text-ink-foreground transition-colors">
                A
              </div>
              <p className="mt-6 font-semibold text-lg">Oui, j'ai un SIREN / SIRET</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Vérification automatique auprès de l'INSEE et du RNE en 30 secondes.
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-teal-dark">
                Vérifier mon numéro →
              </span>
            </Link>

            <Link
              to="/onboarding/diagnostic"
              className="group p-8 bg-card border border-border rounded-2xl text-left hover:border-teal-dark hover:shadow-lg transition-all duration-200 active:scale-[0.99]"
            >
              <div className="num grid size-10 place-items-center rounded-full bg-accent/20 text-sm font-medium text-accent-ink transition-colors group-hover:bg-accent">
                B
              </div>
              <p className="mt-6 font-semibold text-lg">Non / Je ne sais pas</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
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
