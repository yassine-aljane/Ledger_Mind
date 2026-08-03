import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { getStoredUser, isAuthed, postAuthPath, type AuthUser } from "@/lib/auth";
import { usePlan } from "@/lib/plan";
import { Wordmark } from "@/components/lm/Logo";
import { ThemeToggle } from "@/components/lm/AppShell";
import { Button } from "@/components/ui/button";

/**
 * Chrome du site public (accueil). Distinct de l'AppShell applicatif : pas de navigation
 * produit, pas de Centre d'Actions — uniquement l'entrée vers l'espace membre.
 */

/** État de session côté client. Rendu serveur = visiteur, resynchronisé après hydratation. */
function useSession(): { user: AuthUser | null; authed: boolean } {
  const [state, setState] = useState<{ user: AuthUser | null; authed: boolean }>({
    user: null,
    authed: false,
  });
  useEffect(() => {
    setState({ user: getStoredUser(), authed: isAuthed() });
  }, []);
  return state;
}

export function SiteHeader() {
  const { user, authed } = useSession();
  const plan = usePlan();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link to="/" aria-label="LedgerMind, accueil">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <Link to="/education" className="transition-colors hover:text-foreground">
            Assistant fiscal
          </Link>
          {plan === "free" && (
            <Link to="/premium" className="transition-colors hover:text-foreground">
              Offre Premium
            </Link>
          )}
          <Link to={authed ? postAuthPath(user) : "/onboarding"} className="transition-colors hover:text-foreground">
            Mise en route
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {authed ? (
            <Button asChild size="sm">
              <Link to={postAuthPath(user)}>Mon espace</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
                <Link to="/auth">Se connecter</Link>
              </Button>
              <Button asChild size="sm" variant="accent">
                <Link to="/auth">Commencer</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const plan = usePlan();

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            LedgerMind fournit une information fiscale sourcée. Il ne remplace pas un conseil
            personnalisé d&apos;expert-comptable.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/education" className="hover:text-foreground">
            Assistant fiscal
          </Link>
          {plan === "free" && (
            <Link to="/premium" className="hover:text-foreground">
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
