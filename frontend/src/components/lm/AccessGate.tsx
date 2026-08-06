import { Link } from "@tanstack/react-router";
import { Check, Compass, Loader2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/lm/AppShell";
import { PremiumPagePlaceholder, type PremiumKind } from "@/components/lm/PremiumPagePlaceholder";
import { Button } from "@/components/ui/button";
import { useEntitlements, type Feature } from "@/lib/entitlements";
import { markPremiumPending } from "@/lib/plan";

/**
 * Barrière d'accès d'un écran entier.
 *
 * Le contrôle vit ICI, autour de la page, et jamais en tête de la page elle-même : sortir en
 * `return` avant les hooks de l'écran les rendrait conditionnels (ordre des hooks variable d'un
 * rendu à l'autre — bug React, signalé par `react-hooks/rules-of-hooks`). Avec cette barrière,
 * la page n'est pas montée quand elle est fermée : ni hooks, ni requêtes, ni redirection
 * déclenchés pour rien.
 *
 * Chaque motif de fermeture a son écran, parce qu'ils appellent des gestes différents :
 * se connecter, s'abonner, finir son parcours, ou constater qu'il est déjà fini.
 */

/** Le message doit nommer l'outil concerné : « parcours requis » seul n'apprend rien. */
const PARCOURS_COPY: Partial<Record<Feature, { title: string; body: string }>> = {
  dashboard: {
    title: "Terminez la mise en route",
    body: "Répondez aux questions (vérification SIRET ou diagnostic) avant d'accéder à Ma situation.",
  },
  capture: {
    title: "Mise en route requise",
    body: "Les justificatifs se débloquent une fois la vérification et les questions de profil terminées.",
  },
  referral: {
    title: "Mise en route requise",
    body: "La mise en relation avec un expert-comptable est disponible après avoir complété votre mise en route.",
  },
  historique: {
    title: "Mise en route requise",
    body: "Les transactions se débloquent après la fin de la mise en route.",
  },
  simulateur: {
    title: "Mise en route requise",
    body: "Les scénarios fiscaux se débloquent une fois votre profil fiscal construit.",
  },
  activite: {
    title: "Mise en route requise",
    body: "Facture, rapport et déclaration s'appuient sur votre régime : la mise en route doit être terminée.",
  },
  profile: {
    title: "Mise en route requise",
    body: "Mon compte s'ouvre une fois la vérification et les questions d'intake terminées.",
  },
};

function CarteCentree({ children }: { children: ReactNode }) {
  return (
    <div className="animate-rise mx-auto max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
      {children}
    </div>
  );
}

function BlocChargement({ label }: { label: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <Loader2 className="size-5 animate-spin text-primary" />
      <p className="rule-label-lg text-label-ink">{label}</p>
    </div>
  );
}

/** Premium acquis, mais le questionnaire du parcours n'est pas terminé. */
function ParcoursLock({ feature }: { feature: Feature }) {
  const copy = PARCOURS_COPY[feature] ?? {
    title: "Terminez la mise en route",
    body: "Complétez la vérification (ou le diagnostic) et répondez aux questions avant d'utiliser cet outil.",
  };

  return (
    <AppShell>
      <CarteCentree>
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/15">
          <Compass className="size-5 text-accent-ink" />
        </div>
        <p className="rule-label-lg mt-5 text-accent-ink">Premium · mise en route</p>
        <h1 className="mt-3 text-2xl">{copy.title}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">{copy.body}</p>
        {/* Dire explicitement que l'abonnement est actif : sans ça, un écran fermé juste après
            avoir payé se lit comme un problème de paiement. */}
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          Votre abonnement Premium est actif — il reste à compléter le questionnaire de mise en
          route.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="accent">
            <Link to="/onboarding">Continuer la mise en route</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/education">Assistant fiscal</Link>
          </Button>
        </div>
      </CarteCentree>
    </AppShell>
  );
}

/** Premium dont le parcours est déjà terminé : l'étape ne se refait pas. */
function ParcoursDoneLock() {
  return (
    <AppShell>
      <CarteCentree>
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/15">
          <Check className="size-5 text-success-ink" />
        </div>
        <p className="rule-label-lg mt-5 text-label-ink">Mise en route terminée</p>
        <h1 className="mt-3 text-2xl">Vous avez déjà terminé votre mise en route</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          Cette étape est verrouillée : votre profil fiscal est en place. Retrouvez votre synthèse
          et vos prochaines actions dans Ma situation.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="accent">
            <Link to="/dashboard">Aller à Ma situation</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/education">Assistant fiscal</Link>
          </Button>
        </div>
      </CarteCentree>
    </AppShell>
  );
}

/** Visiteur : il faut d'abord un compte — l'Assistant fiscal, lui, reste ouvert. */
function AuthLock({ premiumAttendu }: { premiumAttendu: boolean }) {
  return (
    <AppShell>
      <CarteCentree>
        <h1 className="text-2xl">Connectez-vous pour continuer</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {premiumAttendu
            ? "Cette fonctionnalité fait partie de Premium. L'Assistant fiscal reste ouvert sans compte."
            : "Cet espace s'appuie sur votre dossier. L'Assistant fiscal reste ouvert sans compte."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/education">Aller à l&apos;Assistant fiscal</Link>
          </Button>
          {/* On mémorise l'intention Premium : la formule est attachée à un compte, elle sera
              posée au retour d'authentification plutôt que perdue en route. */}
          <Button asChild variant="accent">
            <Link to="/auth" onClick={() => premiumAttendu && markPremiumPending()}>
              Se connecter
            </Link>
          </Button>
        </div>
      </CarteCentree>
    </AppShell>
  );
}

export function AccessGate({
  feature,
  premiumKind,
  children,
}: {
  feature: Feature;
  /** Écran de démonstration à montrer au palier gratuit (paywall + aperçu). */
  premiumKind?: PremiumKind;
  children: ReactNode;
}) {
  const { lockReason, loading } = useEntitlements();

  // Avant hydratation, l'état réel est inconnu : afficher un refus ici ferait clignoter un
  // écran de blocage devant un utilisateur qui a pourtant les droits.
  if (loading) {
    return (
      <AppShell>
        <BlocChargement label="Vérification de votre accès…" />
      </AppShell>
    );
  }

  switch (lockReason(feature)) {
    case "auth":
      return <AuthLock premiumAttendu={Boolean(premiumKind)} />;
    case "premium":
      return premiumKind ? <PremiumPagePlaceholder kind={premiumKind} /> : <AuthLock premiumAttendu />;
    case "parcours":
      return <ParcoursLock feature={feature} />;
    case "deja_fait":
      return <ParcoursDoneLock />;
    default:
      return <>{children}</>;
  }
}

/* ------------------------------- Bandeaux d'incitation ------------------------------- */

/** Palier gratuit uniquement : proposer Premium au fil d'un écran auquel il a accès. */
export function UpsellStrip({ text, cta = "Passer Premium" }: { text: string; cta?: string }) {
  const { isPremium, loading } = useEntitlements();
  if (loading || isPremium) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[0.9375rem]">{text}</p>
      <Button asChild variant="accent" size="sm" className="shrink-0">
        <Link to="/premium">
          <Sparkles /> {cta}
        </Link>
      </Button>
    </div>
  );
}

/**
 * Premium dont le parcours reste à finir : surtout PAS d'incitation à s'abonner — il l'est
 * déjà. Le seul geste utile est de reprendre là où il s'est arrêté.
 */
export function ParcoursStrip({
  text = "Terminez la vérification et les questions du parcours fiscal pour débloquer tous les outils.",
}: {
  text?: string;
}) {
  const { state, loading } = useEntitlements();
  if (loading || state !== "premium_parcours") return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[0.9375rem]">{text}</p>
      <Button asChild variant="accent" size="sm" className="shrink-0">
        <Link to="/onboarding">Continuer le parcours</Link>
      </Button>
    </div>
  );
}
