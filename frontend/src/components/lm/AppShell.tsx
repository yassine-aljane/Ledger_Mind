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

const nav = [
  { to: "/dashboard", label: "Dashboard", premium: true },
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
      className="px-4 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink/70 hover:border-ink hover:text-ink transition-colors"
    >
      Déconnexion
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<AuthUser | null>(null);

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
          <div className="hidden md:flex items-center gap-8 text-[13px] font-medium">
            {nav.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    active
                      ? "text-teal-dark relative after:absolute after:inset-x-0 after:-bottom-[22px] after:h-px after:bg-teal-dark"
                      : "text-ink/60 hover:text-ink transition-colors"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <LogoutBubble />
            <Link
              to="/parametres"
              className="px-4 py-1.5 bg-ink text-background rounded-full text-[13px] font-medium hover:bg-teal-dark transition-colors max-w-[10rem] truncate"
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
      <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance">{title}</h1>
      {description && (
        <p className="mt-4 text-lg text-ink/60 max-w-2xl text-pretty">{description}</p>
      )}
    </header>
  );
}
