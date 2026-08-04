import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Compass,
  FileStack,
  Gauge,
  History,
  Lock,
  LogOut,
  Moon,
  Receipt,
  Settings,
  Sparkles,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { displayName, logout } from "@/lib/auth";
import { useEntitlements, type Feature, type LockReason } from "@/lib/entitlements";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CentreActionsButton } from "@/components/lm/CentreActions";
import { Wordmark } from "@/components/lm/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Un seul endroit décrit la navigation, et chaque entrée déclare la fonctionnalité dont elle
// dépend : c'est `lib/entitlements` qui décide de son verrouillage, pas le rail lui-même.
const NAV = [
  { to: "/education", label: "Assistant fiscal", icon: BookOpen, feature: "education" },
  { to: "/dashboard", label: "Ma situation", icon: Gauge, feature: "dashboard" },
  { to: "/onboarding", label: "Mise en route", icon: Compass, feature: "onboarding" },
  { to: "/capture", label: "Justificatifs", icon: Receipt, feature: "capture" },
  { to: "/activite", label: "Facturation", icon: Wallet, feature: "activite" },
  { to: "/referral", label: "Expert-comptable", icon: Users, feature: "referral" },
  { to: "/historique", label: "Transactions", icon: History, feature: "historique" },
  { to: "/simulateur", label: "Scénarios", icon: FileStack, feature: "simulateur" },
  { to: "/parametres", label: "Mon compte", icon: Settings, feature: "profile" },
] as const satisfies readonly {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  feature: Feature;
}[];

const LOCK_TITLE: Record<Exclude<LockReason, "none">, string> = {
  auth: "Connectez-vous pour y accéder",
  premium: "Fonctionnalité Premium",
  parcours: "À débloquer en terminant la mise en route",
  deja_fait: "Mise en route terminée",
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
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleSignOut}
      aria-label="Se déconnecter"
      title="Se déconnecter"
      className="text-muted-foreground"
    >
      <LogOut />
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

function NavLink({
  item,
  active,
  motif,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  motif: LockReason;
}) {
  const locked = motif !== "none";
  const label = motif === "deja_fait" ? "Mise en route terminée" : item.label;
  return (
    <Link
      to={item.to}
      title={locked ? LOCK_TITLE[motif] : item.label}
      aria-disabled={locked || undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : locked
            ? "text-muted-foreground/80 hover:bg-secondary hover:text-muted-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {locked && <Lock className="size-3 shrink-0 opacity-70" />}
    </Link>
  );
}

/** Encart bas de rail : ce que vaut la formule actuelle, et le geste qui suit. */
function CarteFormule() {
  const { state, loading } = useEntitlements();

  // Pendant le montage / hydratation : rien — sinon un faux « Se connecter » apparaît puis
  // disparaît à chaque changement de page (AppShell remonte, état un instant « invite »).
  if (loading) return null;
  // Déjà Premium avec parcours fini : pas d'encart.
  if (state === "premium_complet") return null;

  if (state === "free") {
    return (
      <div className="shimmer-premium rounded-2xl border border-accent/40 bg-accent/10 p-4">
        <p className="rule-label text-accent-ink">Formule actuelle · Free</p>
        <p className="mt-2 text-sm font-medium">Débloquez la mise en route et les outils.</p>
        <Button asChild variant="accent" size="sm" className="mt-3 w-full">
          <Link to="/premium">
            <Sparkles /> Passer Premium
          </Link>
        </Button>
      </div>
    );
  }

  if (state === "premium_parcours") {
    return (
      <div className="rounded-2xl border border-accent/40 bg-accent/8 p-4">
        <p className="rule-label text-accent-ink">Mise en route</p>
        <p className="mt-2 text-sm font-medium">
          Terminez-la pour débloquer Ma situation et les outils.
        </p>
        <Button asChild variant="accent" size="sm" className="mt-3 w-full">
          <Link to="/onboarding">Reprendre</Link>
        </Button>
      </div>
    );
  }

  if (state === "invite") {
    return (
      <div className="space-y-2 rounded-2xl border border-border p-4">
        <p className="text-sm font-medium">Assistant fiscal libre</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Posez vos questions fiscales sans compte. Connectez-vous pour conserver
          l&apos;historique.
        </p>
        <Button asChild variant="accent" size="sm" className="w-full">
          <Link to="/auth">Se connecter</Link>
        </Button>
      </div>
    );
  }

  return null;
}

function BlocCompte() {
  const { user, state } = useEntitlements();
  if (state === "invite") return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName(user)}</p>
        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
      </div>
      <LogoutBubble />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state, lockReason, loading } = useEntitlements();
  const authed = state !== "invite";

  const entrees = NAV.map((item) => ({
    item,
    // Avant hydratation, l'état est celui d'un visiteur : masquer les verrous plutôt
    // que d'en afficher de faux. L'entrée « Parcours fiscal » reste TOUJOURS listée —
    // une fois terminée elle passe en `deja_fait` (verrouillée, libellé « Parcours terminé »),
    // elle ne disparaît plus (sinon elle flashait à chaque navigation).
    motif: loading ? ("none" as LockReason) : lockReason(item.feature),
    active: pathname === item.to || pathname.startsWith(`${item.to}/`),
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-[1400px]">
        {/* Rail desktop */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border px-4 py-6 lg:flex">
          {/* Le wordmark ramène à l'accueil du site, comme partout ailleurs sur le web. Le
              raccourci vers l'espace de travail, lui, est l'entrée de navigation correspondante. */}
          <Link to="/" className="px-2" aria-label="LedgerMind, accueil">
            <Wordmark />
          </Link>

          <nav className="mt-8 space-y-1" aria-label="Navigation principale">
            {entrees.map(({ item, motif, active }) => (
              <NavLink key={item.to} item={item} active={active} motif={motif} />
            ))}
          </nav>

          <div className="mt-auto space-y-3 pt-6">
            <CarteFormule />
            <BlocCompte />
            <div className="flex items-center justify-between px-1">
              <span className="rule-label text-muted-foreground">Apparence</span>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Header mobile */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
            <Link to="/" aria-label="LedgerMind, accueil">
              <Wordmark />
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant={state === "premium_complet" ? "accent" : "outline"}>
                {state === "invite"
                  ? "Visiteur"
                  : state === "free"
                    ? "Free"
                    : state === "premium_parcours"
                      ? "Premium · parcours"
                      : "Premium"}
              </Badge>
              {authed && <CentreActionsButton variante="veille" />}
              {authed && <CentreActionsButton />}
              <ThemeToggle />
              {authed && <LogoutBubble />}
            </div>
          </header>

          {/* Le Centre d'Actions vit hors du rail : il ouvre un panneau, ce n'est pas une page. */}
          {authed && (
            <div className="hidden justify-end gap-2 px-8 pt-6 lg:flex">
              <CentreActionsButton variante="veille" />
              <CentreActionsButton />
            </div>
          )}

          <main className="px-4 pb-28 pt-6 sm:px-8 lg:pb-16">{children}</main>
        </div>
      </div>

      {/* Barre mobile */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden"
      >
        <div className="flex overflow-x-auto">
          {entrees.slice(0, 5).map(({ item, motif, active }) => (
            <Link
              key={item.to}
              to={item.to}
              title={motif !== "none" ? LOCK_TITLE[motif] : item.label}
              className={cn(
                "flex flex-1 shrink-0 flex-col items-center gap-1 px-3 py-2.5 text-[0.5rem] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-4" />
                {motif !== "none" && (
                  <Lock className="absolute -right-2 -top-1 size-2.5 text-accent" />
                )}
              </span>
              {motif === "deja_fait" ? "Mise en route terminée" : item.label}
            </Link>
          ))}
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
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="animate-rise mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="rule-label mb-2 text-accent-ink">{eyebrow}</p>}
        <h1 className="text-balance text-3xl sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
