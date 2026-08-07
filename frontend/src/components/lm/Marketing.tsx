import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
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
    <footer className="border-t border-ink-foreground/10 bg-ink text-ink-foreground">
      <div className="mx-auto grid max-w-6xl gap-9 px-5 py-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-14">
        <div className="sm:col-span-2 lg:col-span-1">
          <Wordmark onInk />
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-foreground/60">
            Information fiscale sourcée et outils de préparation pour indépendants et créateurs.
            LedgerMind ne remplace pas un conseil personnalisé d&apos;expert-comptable.
          </p>
        </div>

        <nav aria-label="Produit" className="space-y-2.5 text-sm">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-safran">
            Produit
          </p>
          <Link to="/education" className="block text-ink-foreground/65 transition-colors hover:text-ink-foreground">
            Assistant fiscal
          </Link>
          <Link to="/onboarding" className="block text-ink-foreground/65 transition-colors hover:text-ink-foreground">
            Mise en route
          </Link>
          {plan === "free" && (
            <Link to="/premium" className="block text-ink-foreground/65 transition-colors hover:text-ink-foreground">
              Offre Premium
            </Link>
          )}
        </nav>

        <nav aria-label="Compte" className="space-y-2.5 text-sm">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-safran">
            Compte
          </p>
          <Link to="/auth" className="block text-ink-foreground/65 transition-colors hover:text-ink-foreground">
            Se connecter
          </Link>
          <Link to="/auth" className="block text-ink-foreground/65 transition-colors hover:text-ink-foreground">
            Créer un compte
          </Link>
        </nav>
      </div>

      <div className="border-t border-ink-foreground/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-4 text-xs text-ink-foreground/45 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 leading-relaxed">
            <Sparkles className="size-3.5 shrink-0 text-safran" aria-hidden />
            Conçu avec l&apos;IA en toute transparence · Les réponses importantes restent à vérifier.
          </p>
          <p className="shrink-0">© 2026 LedgerMind</p>
        </div>
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
