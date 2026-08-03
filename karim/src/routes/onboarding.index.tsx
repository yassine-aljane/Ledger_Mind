import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { PremiumGate } from "@/components/paywall";
import { Button, LoadingBlock } from "@/components/ui-kit";
import { useAuth, useEntitlements } from "@/lib/auth";

export const Route = createFileRoute("/onboarding/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — commencez par l'essentiel" },
      {
        name: "description",
        content: "Freelance ou créateur ? En 2 minutes, on clarifie votre situation fiscale.",
      },
      { property: "og:title", content: "LedgerMind — commencez par l'essentiel" },
    ],
  }),
  component: OnboardingHub,
});

function SiretGate() {
  const { signOut } = useAuth();
  const { onboardingComplete, resumePath, loading: entitlementsLoading } = useEntitlements();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (entitlementsLoading) return;

    // Parcours terminé → PremiumGate affiche « déjà passé cette étape » (ne pas rediriger).
    if (onboardingComplete) {
      setReady(false);
      return;
    }

    if (resumePath !== "/onboarding") {
      void navigate({ to: resumePath, replace: true });
      return;
    }

    setReady(true);
  }, [entitlementsLoading, onboardingComplete, resumePath, navigate]);

  function handleSignOut() {
    signOut();
    void navigate({ to: "/auth" });
  }

  if (!ready || entitlementsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <LoadingBlock label="Préparation de votre parcours…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
        <Link to="/" aria-label="LedgerMind, accueil">
          <Wordmark />
        </Link>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut className="size-4" /> Se déconnecter
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <section className="animate-rise w-full max-w-2xl text-center">
          <p className="rule-label mb-6 text-accent-foreground">Étape 01 · Statut administratif</p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] sm:text-5xl md:text-6xl">
            Commençons par <span className="italic font-normal">l&apos;essentiel.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-lg text-pretty text-lg text-muted-foreground">
            Avez-vous déjà un statut administratif ou un numéro SIREN / SIRET enregistré pour votre
            activité ?
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            <Link
              to="/onboarding/verification"
              className="group rounded-2xl border border-border bg-card p-8 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lift"
            >
              <div className="grid size-10 place-items-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                A
              </div>
              <p className="mt-6 text-lg font-semibold">Oui, j&apos;ai un SIREN / SIRET</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Vérification automatique auprès de l&apos;INSEE et du RNE en 30 secondes.
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                Vérifier mon numéro →
              </span>
            </Link>

            <Link
              to="/onboarding/diagnostic"
              className="group rounded-2xl border border-border bg-card p-8 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lift"
            >
              <div className="grid size-10 place-items-center rounded-full bg-accent/15 font-mono text-sm font-semibold text-accent-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                B
              </div>
              <p className="mt-6 text-lg font-semibold">Non / Je ne sais pas</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Diagnostic guidé pour devenir légal et actif — sans créer de profil fiscal.
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                Lancer le diagnostic →
              </span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function OnboardingHub() {
  return (
    <PremiumGate
      feature="onboarding"
      title="Le parcours fiscal complet"
      pitch="De la vérification de votre établissement à la feuille de route datée, étape par étape."
      benefits={[
        "Diagnostic sans SIREN en 5 minutes",
        "Vérification SIRET auprès des registres officiels",
        "Feuille de route avec échéances et seuils",
      ]}
      preview={
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="rule-label text-muted-foreground">Étape 01 · Statut administratif</p>
          <p className="mt-4 text-2xl font-semibold">Avez-vous un SIREN / SIRET ?</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-4 text-sm">Oui — vérification</div>
            <div className="rounded-xl border border-border p-4 text-sm">Non — diagnostic</div>
          </div>
        </div>
      }
    >
      <SiretGate />
    </PremiumGate>
  );
}
