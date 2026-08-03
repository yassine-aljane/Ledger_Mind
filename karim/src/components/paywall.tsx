import { Link } from "@tanstack/react-router";
import { Check, Compass, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink, Card, SectionLabel, LoadingBlock } from "./ui-kit";
import { setPendingPremium } from "@/lib/api";
import { GATED_PREMIUM_FEATURES, useEntitlements, type Feature } from "@/lib/auth";
import { AppShell } from "./app-shell";

const PARCOURS_COPY: Partial<Record<Feature, { title: string; body: string }>> = {
  dashboard: {
    title: "Terminez le parcours fiscal",
    body: "Répondez aux questions du parcours (vérification SIRET ou diagnostic) avant d'accéder au tableau de bord.",
  },
  capture: {
    title: "Parcours fiscal requis",
    body: "La capture de factures se débloque une fois la vérification et les questions de profil terminées.",
  },
  referral: {
    title: "Parcours fiscal requis",
    body: "La mise en relation avec des cabinets est disponible après avoir complété votre parcours fiscal.",
  },
  historique: {
    title: "Parcours fiscal requis",
    body: "L'historique complet se débloque après la fin du parcours fiscal.",
  },
  simulateur: {
    title: "Parcours fiscal requis",
    body: "Le simulateur se débloque une fois votre profil fiscal construit via le parcours.",
  },
};

function ParcoursLock({ feature }: { feature: Feature }) {
  const { resumePath } = useEntitlements();
  const copy = PARCOURS_COPY[feature] ?? {
    title: "Terminez le parcours fiscal",
    body: "Complétez la vérification (ou le diagnostic) et répondez aux questions avant d'utiliser cet outil.",
  };

  return (
    <AppShell>
      <Card className="mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/15">
          <Compass className="size-6 text-accent" />
        </div>
        <SectionLabel className="mt-5 justify-center">Premium · parcours en cours</SectionLabel>
        <h1 className="mt-3 text-2xl">{copy.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{copy.body}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Votre abonnement Premium est actif — il reste à compléter le questionnaire du parcours fiscal.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink to={resumePath} variant="safran">
            Continuer le parcours fiscal
          </ButtonLink>
          <ButtonLink to="/education" variant="outline">
            Éducation
          </ButtonLink>
        </div>
      </Card>
    </AppShell>
  );
}

/** Premium user who already finished onboarding — parcours is locked. */
function ParcoursDoneLock() {
  return (
    <AppShell>
      <Card className="mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/15">
          <Check className="size-6 text-success" />
        </div>
        <SectionLabel className="mt-5 justify-center">Étape déjà validée</SectionLabel>
        <h1 className="mt-3 text-2xl">Vous avez déjà terminé votre parcours fiscal</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Cette étape est verrouillée : votre profil fiscal est en place. Retrouvez votre synthèse et vos
          prochaines actions sur le tableau de bord.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink to="/dashboard" variant="safran">
            Aller au tableau de bord
          </ButtonLink>
          <ButtonLink to="/education" variant="outline">
            Éducation
          </ButtonLink>
        </div>
      </Card>
    </AppShell>
  );
}

function PremiumPaywall({
  title,
  pitch,
  benefits,
  preview,
}: {
  title: string;
  pitch: string;
  benefits: string[];
  preview: ReactNode;
}) {
  return (
    <AppShell>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative">
          <div className="pointer-events-none select-none [mask-image:linear-gradient(to_bottom,black_38%,transparent_96%)]">
            {preview}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
          <span className="rule-label absolute right-4 top-4 rounded-full bg-ink px-3 py-1 text-ink-foreground">
            Exemple de démonstration
          </span>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card className="animate-rise overflow-hidden">
            <div className="shimmer-premium surface-ink px-6 py-7">
              <span className="inline-flex items-center gap-2 rounded-full border border-ink-foreground/25 px-3 py-1 text-xs font-semibold text-ink-foreground">
                <Lock className="size-3.5" /> Inclus dans Premium
              </span>
              <h2 className="mt-4 text-2xl text-ink-foreground">{title}</h2>
              <p className="mt-2 text-sm text-ink-foreground/75">{pitch}</p>
            </div>
            <div className="space-y-3 p-6">
              {benefits.map((b) => (
                <p key={b} className="flex gap-3 text-sm text-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  {b}
                </p>
              ))}
              <ButtonLink to="/abonnement" variant="safran" className="mt-4 w-full">
                <Sparkles /> Passer Premium
              </ButtonLink>
              <Link
                to="/education"
                className="block pt-1 text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Continuer gratuitement sur Éducation
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

export function PremiumGate({
  feature,
  title,
  pitch,
  benefits,
  preview,
  children,
}: {
  feature: Feature;
  title: string;
  pitch: string;
  benefits: string[];
  preview: ReactNode;
  children: ReactNode;
}) {
  const { isAuthenticated, loading, lockReason } = useEntitlements();

  if (loading) {
    return (
      <AppShell>
        <LoadingBlock label="Vérification de votre accès…" />
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-2xl">Connectez-vous pour continuer</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Cette fonctionnalité fait partie de Premium. L'Éducation fiscale reste ouverte sans compte.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink to="/education" variant="outline">
              Aller à l'Éducation
            </ButtonLink>
            <ButtonLink to="/auth" variant="safran" onClick={() => setPendingPremium(true)}>
              Se connecter
            </ButtonLink>
          </div>
        </Card>
      </AppShell>
    );
  }

  const reason = lockReason(feature);
  if (reason === "done") {
    return <ParcoursDoneLock />;
  }
  if (reason === "parcours" && GATED_PREMIUM_FEATURES.includes(feature)) {
    return <ParcoursLock feature={feature} />;
  }
  if (reason === "premium") {
    return <PremiumPaywall title={title} pitch={pitch} benefits={benefits} preview={preview} />;
  }

  return <>{children}</>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useEntitlements();
  if (loading)
    return (
      <AppShell>
        <LoadingBlock label="Chargement de votre session…" />
      </AppShell>
    );
  if (!isAuthenticated)
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg p-8 text-center">
          <SectionLabel className="justify-center">Accès membre</SectionLabel>
          <h1 className="mt-3 text-2xl">Connectez-vous</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Créez un compte pour sauvegarder l'historique de vos échanges, ou pour accéder aux outils Premium.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <ButtonLink to="/education" variant="outline">
              Continuer sur Éducation
            </ButtonLink>
            <ButtonLink to="/auth" variant="safran">
              Se connecter
            </ButtonLink>
          </div>
        </Card>
      </AppShell>
    );
  return <>{children}</>;
}

/** Free users only — upgrade to Premium. */
export function UpsellStrip({ text, cta = "Passer Premium" }: { text: string; cta?: string }) {
  const { isPremium } = useEntitlements();
  if (isPremium) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-foreground">{text}</p>
      <ButtonLink to="/abonnement" variant="safran" size="sm">
        {cta}
      </ButtonLink>
    </div>
  );
}

/** Premium users with incomplete parcours — no Premium upsell. */
export function ParcoursStrip({
  text = "Terminez la vérification et les questions du parcours fiscal pour débloquer tous les outils.",
}: {
  text?: string;
}) {
  const { isPremium, onboardingComplete, resumePath } = useEntitlements();
  if (!isPremium || onboardingComplete) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-foreground">{text}</p>
      <ButtonLink to={resumePath} variant="safran" size="sm">
        Continuer le parcours
      </ButtonLink>
    </div>
  );
}
