import { createFileRoute, Link } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Wordmark } from "@/components/lm/Logo";

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
        <Link to="/" aria-label="LedgerMind, accueil">
          <Wordmark />
        </Link>
        <LogoutBubble />
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <section className="max-w-2xl w-full text-center animate-rise">
          <p className="rule-label mb-6 text-accent-ink">
            Étape 01 · Statut administratif
          </p>
          <h1 className="text-balance text-4xl leading-[1.02] md:text-5xl">
            Commençons par <span className="italic font-normal">l'essentiel.</span>
          </h1>
          <p className="mt-8 text-lg text-muted-foreground text-pretty max-w-lg mx-auto">
            Avez-vous déjà un statut administratif ou un numéro SIREN / SIRET enregistré pour votre activité ?
          </p>

          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <Link
              to="/onboarding/verification"
              className="card-hover group rounded-2xl border border-border bg-card p-8 text-left shadow-soft transition-all duration-200 hover:border-ink active:scale-[0.99]"
            >
              <div className="num grid size-10 place-items-center rounded-full bg-primary/10 text-sm font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                A
              </div>
              <p className="mt-6 text-lg font-medium">Oui, j'ai un SIREN / SIRET</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Vérification automatique auprès de l'INSEE et du RNE en 30 secondes.
              </p>
              <span className="rule-label mt-6 inline-flex items-center gap-1.5 text-accent-ink">
                Vérifier mon numéro →
              </span>
            </Link>

            <Link
              to="/onboarding/diagnostic"
              className="card-hover group rounded-2xl border border-border bg-card p-8 text-left shadow-soft transition-all duration-200 hover:border-ink active:scale-[0.99]"
            >
              <div className="num grid size-10 place-items-center rounded-full bg-accent/20 text-sm font-medium text-accent-ink transition-colors group-hover:bg-accent">
                B
              </div>
              <p className="mt-6 text-lg font-medium">Non / Je ne sais pas</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Diagnostic guidé pour devenir légal et actif — sans créer de profil fiscal.
              </p>
              <span className="rule-label mt-6 inline-flex items-center gap-1.5 text-accent-ink">
                Lancer le diagnostic →
              </span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
