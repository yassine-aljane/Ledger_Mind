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
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  displayShortName,
  getStoredUser,
  isAuthed,
  logout,
  type AuthUser,
} from "@/lib/auth";
import { usePlan } from "@/lib/plan";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CentreActionsButton } from "@/components/lm/CentreActions";
import { Wordmark } from "@/components/lm/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Dashboard et Éducation restent accessibles sans premium (guidance/pédagogue + le dashboard,
// dont le contenu s'adapte lui-même selon la vérification SIREN — voir dashboard.tsx). Tout le
// reste (expert-comptable, documents, simulateur, historique) est une fonctionnalité premium.
const nav = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge, premium: false },
  { to: "/activite", label: "Activité", icon: Wallet, premium: true },
  { to: "/referral", label: "Expert-Comptable", icon: Users, premium: true },
  { to: "/capture", label: "Documents", icon: Receipt, premium: true },
  { to: "/simulateur", label: "Simulateur", icon: FileStack, premium: true },
  { to: "/historique", label: "Historique", icon: History, premium: true },
  { to: "/education", label: "Éducation", icon: BookOpen, premium: false },
] as const satisfies readonly {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  premium: boolean;
}[];

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
  const plan = usePlan();

  useEffect(() => {
    setUser(getStoredUser());
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <nav className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
          <Link to="/dashboard" className="shrink-0" aria-label="LedgerMind, tableau de bord">
            <Wordmark />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active = pathname.startsWith(item.to);
              const locked = item.premium && plan === "free";
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={locked ? "Fonctionnalité Premium" : item.label}
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
            {isAuthed() && <CentreActionsButton />}
            <ThemeToggle />
            <LogoutBubble />
            <Link
              to="/parametres"
              className="inline-flex h-8 max-w-40 items-center truncate rounded-full bg-primary px-3.5 text-[0.62rem] font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              title={user ? displayShortName(user) : "Compte"}
            >
              {isAuthed() ? displayShortName(user) : "Compte"}
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
