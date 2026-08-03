import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  FileStack,
  Gauge,
  History,
  Lock,
  LogOut,
  Moon,
  Receipt,
  Sparkles,
  Sun,
  Compass,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  displayShortName,
  getStoredUser,
  logout,
  type AuthUser,
} from "@/lib/auth";
import { useEntitlements, type Feature, type LockReason } from "@/lib/entitlements";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CentreActionsButton } from "@/components/lm/CentreActions";
import { Wordmark } from "@/components/lm/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Un seul endroit décrit la navigation, et chaque entrée déclare la fonctionnalité dont elle
// dépend : c'est `lib/entitlements` qui décide de son verrouillage, pas la barre elle-même.
const nav = [
  { to: "/education", label: "Éducation", icon: BookOpen, feature: "education" },
  { to: "/onboarding", label: "Parcours", icon: Compass, feature: "onboarding" },
  { to: "/dashboard", label: "Dashboard", icon: Gauge, feature: "dashboard" },
  { to: "/activite", label: "Activité", icon: Wallet, feature: "activite" },
  { to: "/referral", label: "Expert-Comptable", icon: Users, feature: "referral" },
  { to: "/capture", label: "Documents", icon: Receipt, feature: "capture" },
  { to: "/simulateur", label: "Simulateur", icon: FileStack, feature: "simulateur" },
  { to: "/historique", label: "Historique", icon: History, feature: "historique" },
] as const satisfies readonly {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  feature: Feature;
}[];

const LOCK_TITLE: Record<Exclude<LockReason, "none">, string> = {
  auth: "Connectez-vous pour y accéder",
  premium: "Fonctionnalité Premium",
  parcours: "À débloquer en terminant votre parcours",
  deja_fait: "Parcours déjà terminé",
};

export function LogoutBubble() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  function handleSignOut() {
    queryClient.clear();
    logout();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1.5 text-muted-foreground">
      <LogOut />
      <span className="hidden lg:inline">Déconnexion</span>
    </Button>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      className={cn("text-muted-foreground", className)}
      aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
      title={theme === "dark" ? "Thème clair" : "Thème sombre"}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<AuthUser | null>(null);
  const { state, plan, lockReason, landingPath } = useEntitlements();

  useEffect(() => {
    setUser(getStoredUser());
  }, [pathname]);

  const authed = state !== "invite";

  return (
    <div className="min-h-screen">
      <nav className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
          {/* Le logo ramène à l'écran auquel l'utilisateur a droit, pas systématiquement au
              tableau de bord — qui est fermé tant que le parcours n'est pas terminé. */}
          <Link to={landingPath} className="shrink-0" aria-label="LedgerMind, accueil">
            <Wordmark />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active = pathname.startsWith(item.to);
              const motif = lockReason(item.feature);
              const locked = motif !== "none";
              // « Parcours terminé » n'est pas un verrou à afficher : l'entrée disparaît, elle
              // n'a plus rien à proposer. Les autres motifs restent visibles, cadenassés — ils
              // montrent ce que l'utilisateur gagnerait à débloquer.
              if (motif === "deja_fait") return null;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={locked ? LOCK_TITLE[motif] : item.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.62rem] font-medium transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="size-3.5 shrink-0" />
                  {item.label}
                  {locked && <Lock className="size-3 shrink-0 text-accent" />}
                </Link>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {plan === "free" ? (
              <Link
                to="/premium"
                className="shimmer-premium hidden items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[0.55rem] font-medium uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent/20 sm:inline-flex"
              >
                <Sparkles className="size-3" />
                Passer Premium
              </Link>
            ) : (
              <Badge variant="accent" className="hidden sm:inline-flex">
                <Sparkles /> Premium
              </Badge>
            )}
            {authed && <CentreActionsButton />}
            <ThemeToggle />
            {authed && <LogoutBubble />}
            <Link
              to={authed ? "/parametres" : "/auth"}
              className="inline-flex h-8 max-w-40 items-center truncate rounded-full bg-primary px-3.5 text-[0.62rem] font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              title={user ? displayShortName(user) : "Compte"}
            >
              {authed ? displayShortName(user) : "Se connecter"}
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 pb-24 pt-24">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="animate-rise mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="rule-label mb-3 text-accent-ink">{eyebrow}</p>}
        <h1 className="text-balance text-4xl md:text-5xl">{title}</h1>
        {description && (
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
