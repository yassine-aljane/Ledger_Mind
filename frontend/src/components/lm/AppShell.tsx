import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  displayShortName,
  getStoredUser,
  isAuthed,
  logout,
  type AuthUser,
} from "@/lib/auth";
import { usePlan } from "@/lib/plan";
import { CentreActionsButton } from "@/components/lm/CentreActions";

// Dashboard et Éducation restent accessibles sans premium (guidance/pédagogue + le dashboard,
// dont le contenu s'adapte lui-même selon la vérification SIREN — voir dashboard.tsx). Tout le
// reste (expert-comptable, documents, simulateur, historique) est une fonctionnalité premium.
const nav = [
  { to: "/dashboard", label: "Dashboard", premium: false },
  { to: "/activite", label: "Activité", premium: true },
  { to: "/referral", label: "Expert-Comptable", premium: true },
  { to: "/capture", label: "Documents", premium: true },
  { to: "/simulateur", label: "Simulateur", premium: true },
  { to: "/historique", label: "Historique", premium: true },
  { to: "/education", label: "Éducation", premium: false },
] as const;

export function LogoutBubble() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  function handleSignOut() {
    queryClient.clear();
    logout();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="px-4 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink/70 hover:border-ink hover:text-ink transition-all duration-200 active:scale-[0.97]"
    >
      Déconnexion
    </button>
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
      <nav className="fixed top-0 inset-x-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="size-6 rounded-full bg-teal-dark" />
            <span className="font-semibold tracking-tight uppercase text-sm">LedgerMind</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-[13px] font-medium">
            {nav.map((item) => {
              const active = pathname.startsWith(item.to);
              const locked = item.premium && plan === "free";
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={locked ? "Fonctionnalité Premium" : item.label}
                  className={
                    active
                      ? "text-teal-dark relative after:absolute after:inset-x-0 after:-bottom-[22px] after:h-px after:bg-teal-dark inline-flex items-center gap-1.5"
                      : "text-ink/60 hover:text-ink transition-colors inline-flex items-center gap-1.5"
                  }
                >
                  {item.label}
                  {locked && (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden className="text-amber-fiscal">
                      <rect x="2" y="5.5" width="8" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  )}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {plan === "free" ? (
              <Link
                to="/premium"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-fiscal/10 border border-amber-fiscal/30 text-amber-fiscal text-[12px] font-semibold hover:bg-amber-fiscal hover:text-ink transition-all duration-200 active:scale-[0.97]"
              >
                <span className="size-1.5 rounded-full bg-amber-fiscal animate-pulse" />
                Passer Premium
              </Link>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-dark/10 border border-teal-dark/30 text-teal-dark text-[12px] font-semibold font-mono uppercase tracking-widest">
                Premium
              </span>
            )}
            {isAuthed() && <CentreActionsButton />}
            <LogoutBubble />
            <Link
              to="/parametres"
              className="px-4 py-1.5 bg-ink text-background rounded-full text-[13px] font-medium hover:bg-teal-dark transition-all duration-200 active:scale-[0.97] max-w-[10rem] truncate"
              title={user ? displayShortName(user) : "Compte"}
            >
              {isAuthed() ? displayShortName(user) : "Compte"}
            </Link>
          </div>
        </div>
      </nav>
      <main className="pt-24 pb-24 px-6 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
}) {
  return (
    <header className="animate-slide-up mb-12">
      {eyebrow && (
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark mb-4">
          {eyebrow}
        </p>
      )}
      <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter text-balance">{title}</h1>
      {description && (
        <p className="mt-4 text-lg md:text-xl text-ink/60 max-w-2xl text-pretty leading-relaxed">{description}</p>
      )}
    </header>
  );
}
