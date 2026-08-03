import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Wordmark } from "@/components/lm/Logo";
import { repriseEnCours, routeDeReprise } from "@/lib/reprise";

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
  const navigate = useNavigate();
  // Tant qu'on n'a pas interrogé le serveur, on ne sait pas s'il faut poser la question
  // du choix ou reprendre un parcours entamé. Afficher le choix d'abord le ferait
  // clignoter devant quelqu'un qui y a déjà répondu.
  const [verification, setVerification] = useState(true);

  /**
   * Un parcours interrompu se reprend à son étape, pas à son début.
   *
   * Sans ce contrôle, revenir ici après avoir validé son SIRET reposait la question
   * « avez-vous un SIREN ? », et repartir de la branche A ouvrait une nouvelle session :
   * la vérification déjà faite et le KBIS en attente étaient perdus.
   */
  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        // Intake d'abord (vérif + profil), puis guidance — pour reprendre exactement
        // l'étape en cours plutôt que le choix « avez-vous un SIREN ? ».
        const reprise =
          (await repriseEnCours("intake")) ?? (await repriseEnCours("guidance"));
        if (annule) return;
        const cible = reprise ? routeDeReprise(reprise.detail) : null;
        if (cible) {
          navigate({ to: cible, replace: true });
          return;
        }
      } catch {
        // Rien de reprenable : on pose la question normalement.
      }
      if (!annule) setVerification(false);
    })();
    return () => {
      annule = true;
    };
  }, [navigate]);

  if (verification) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

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
