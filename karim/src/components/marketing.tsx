import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Wordmark } from "./logo";
import { ButtonLink } from "./ui-kit";
import { useAuth, useEntitlements } from "@/lib/auth";

export function SiteHeader() {
  const { user } = useAuth();
  const { isPremium, onboardingComplete, loading, resumePath } = useEntitlements();

  const memberCta = (() => {
    if (!user) return null;
    if (loading) {
      return (
        <ButtonLink to="/education" size="sm" variant="primary">
          Mon espace
        </ButtonLink>
      );
    }
    if (isPremium) {
      return onboardingComplete ? (
        <ButtonLink to="/dashboard" size="sm" variant="primary">
          Tableau de bord
        </ButtonLink>
      ) : (
        <ButtonLink to={resumePath} size="sm" variant="safran">
          Continuer le parcours
        </ButtonLink>
      );
    }
    return (
      <ButtonLink to="/education" size="sm" variant="primary">
        Mon espace
      </ButtonLink>
    );
  })();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link to="/" aria-label="LedgerMind, accueil">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <Link to="/education" className="transition-colors hover:text-foreground">
            Éducation
          </Link>
          {!isPremium && (
            <Link to="/abonnement" className="transition-colors hover:text-foreground">
              Offre Premium
            </Link>
          )}
          {user && isPremium && onboardingComplete && (
            <Link to="/dashboard" className="transition-colors hover:text-foreground">
              Tableau de bord
            </Link>
          )}
          <Link
            to={user && isPremium && !onboardingComplete ? resumePath : "/onboarding"}
            className="transition-colors hover:text-foreground"
          >
            Parcours fiscal
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            memberCta
          ) : (
            <>
              <ButtonLink to="/auth" size="sm" variant="quiet" className="hidden sm:inline-flex">
                Se connecter
              </ButtonLink>
              <ButtonLink to="/auth" size="sm" variant="safran">
                Commencer
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { isPremium } = useEntitlements();

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            LedgerMind fournit une information fiscale sourcée. Il ne remplace pas un conseil personnalisé
            d'expert-comptable.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/education" className="hover:text-foreground">
            Éducation
          </Link>
          {!isPremium && (
            <Link to="/abonnement" className="hover:text-foreground">
              Tarifs
            </Link>
          )}
          <Link to="/auth" className="hover:text-foreground">
            Connexion
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
