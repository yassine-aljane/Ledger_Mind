  import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
  import {
    BookOpen,
    Compass,
    FileStack,
    Gauge,
    History,
    LogOut,
    Receipt,
    Settings,
    Sparkles,
    Users,
    Lock,
  } from "lucide-react";
  import type { ReactNode } from "react";
  import { Wordmark } from "./logo";
  import { Badge, Button, ButtonLink } from "./ui-kit";
  import { useAuth, useEntitlements, type Feature } from "@/lib/auth";
  import { cn } from "@/lib/utils";

  interface NavItem {
    to: string;
    label: string;
    icon: typeof BookOpen;
    feature: Feature;
  }

  const NAV: NavItem[] = [
    { to: "/education", label: "Éducation", icon: BookOpen, feature: "education" },
    { to: "/dashboard", label: "Tableau de bord", icon: Gauge, feature: "dashboard" },
    { to: "/onboarding", label: "Parcours fiscal", icon: Compass, feature: "onboarding" },
    { to: "/capture", label: "Capture", icon: Receipt, feature: "capture" },
    { to: "/referral", label: "Cabinets", icon: Users, feature: "referral" },
    { to: "/historique", label: "Historique", icon: History, feature: "historique" },
    { to: "/simulateur", label: "Simulateur", icon: FileStack, feature: "simulateur" },
    { to: "/parametres", label: "Profil", icon: Settings, feature: "profile" },
  ];

  export function AppShell({ children }: { children: ReactNode }) {
    const { user, signOut } = useAuth();
    const {
      lockReason,
      isPremium,
      onboardingComplete,
      loading: entitlementsLoading,
      resumePath,
    } = useEntitlements();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();

    function handleSignOut() {
      signOut();
      void navigate({ to: "/auth" });
    }

    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-[1400px]">
          {/* Rail desktop */}
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border px-4 py-6 lg:flex">
            <Link to="/" className="px-2">
              <Wordmark />
            </Link>

            <div className="mt-8 space-y-1">
              {NAV.map((item) => {
                const locked = !entitlementsLoading && lockReason(item.feature) !== "none";
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {locked && <Lock className="size-3.5 opacity-70" />}
                  </Link>
                );
              })}
            </div>

            <div className="mt-auto space-y-3 pt-6">
              {user && isPremium && !onboardingComplete && !entitlementsLoading && (
                <div className="rounded-2xl border border-accent/30 bg-accent/8 p-4">
                  <p className="rule-label text-accent-foreground">Parcours en cours</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    Terminez la vérification et le profil fiscal pour débloquer le tableau de bord.
                  </p>
                  <ButtonLink to={resumePath} variant="safran" size="sm" className="mt-3 w-full">
                    Reprendre le parcours
                  </ButtonLink>
                </div>
              )}
              {user && !isPremium && !entitlementsLoading && (
                <div className="shimmer-premium rounded-2xl border border-accent/30 bg-accent/8 p-4">
                  <p className="rule-label text-accent-foreground">Formule actuelle · Free</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    Débloquez le parcours fiscal complet.
                  </p>
                  <ButtonLink to="/abonnement" variant="safran" size="sm" className="mt-3 w-full">
                    <Sparkles /> Passer Premium
                  </ButtonLink>
                </div>
              )}
              {user ? (
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.name || "Mon compte"}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Se déconnecter">
                    <LogOut />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <p className="text-sm font-medium">Éducation libre</p>
                  <p className="text-xs text-muted-foreground">
                    L'agent pédagogique est ouvert sans compte. Connectez-vous seulement pour sauvegarder
                    l'historique ou passer Premium.
                  </p>
                  <ButtonLink to="/education" variant="outline" size="sm" className="w-full">
                    Continuer sur Éducation
                  </ButtonLink>
                  <ButtonLink to="/auth" variant="safran" size="sm" className="w-full">
                    Se connecter
                  </ButtonLink>
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {/* Header mobile */}
            <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
              <Link to="/">
                <Wordmark />
              </Link>
              <div className="flex items-center gap-2">
                <Badge tone={isPremium ? "accent" : "neutral"}>
                  {!user
                    ? "Visiteur"
                    : isPremium
                      ? onboardingComplete
                        ? "Premium"
                        : "Premium · parcours"
                      : "Free"}
                </Badge>
                {user && (
                  <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Se déconnecter">
                    <LogOut className="size-4" />
                  </Button>
                )}
              </div>
            </header>

            <main className="px-4 pb-28 pt-6 sm:px-8 lg:pb-16 lg:pt-10">{children}</main>
          </div>
        </div>

        {/* Barre mobile */}
        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden"
        >
          <div className="flex overflow-x-auto">
            {NAV.slice(0, 5).map((item) => {
              const active = pathname.startsWith(item.to);
              const locked = !entitlementsLoading && lockReason(item.feature) !== "none";
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex flex-1 shrink-0 flex-col items-center gap-1 px-3 py-2.5 text-[11px] font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className="relative">
                    <item.icon className="size-5" />
                    {locked && (
                      <Lock className="absolute -right-2 -top-1 size-3 text-accent" />
                    )}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
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
    title: string;
    description?: string;
    actions?: ReactNode;
  }) {
    return (
      <div className="animate-rise mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          {eyebrow && <p className="rule-label mb-2 text-accent-foreground">{eyebrow}</p>}
          <h1 className="text-3xl sm:text-4xl">{title}</h1>
          {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    );
  }
