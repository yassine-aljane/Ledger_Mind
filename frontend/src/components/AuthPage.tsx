import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  fetchMe,
  getStoredUser,
  isAuthed,
  loginAccount,
  postAuthPath,
  registerAccount,
} from "@/lib/auth";
import { Wordmark } from "@/components/lm/Logo";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed()) return;
    const cached = getStoredUser();
    if (cached) {
      navigate({ to: postAuthPath(cached), replace: true });
      return;
    }
    fetchMe()
      .then((u) => navigate({ to: postAuthPath(u), replace: true }))
      .catch(() => navigate({ to: "/onboarding", replace: true }));
  }, [navigate]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    if (!email || !password) {
      setError("Email et mot de passe requis.");
      return;
    }
    if (mode === "signup" && !name) {
      setError("Indiquez votre nom complet.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setLoading(true);
    try {
      const res =
        mode === "signup"
          ? await registerAccount({ email, password, name })
          : await loginAccount({ email, password });
      navigate({ to: postAuthPath(res.user), replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'authentification.");
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="surface-ink relative flex flex-col justify-between overflow-hidden px-8 py-10 md:w-[46%] md:px-14 md:py-14">
        <div aria-hidden className="surface-grain absolute inset-0 opacity-40" />
        <div
          aria-hidden
          className="absolute -right-24 -top-24 size-[420px] rounded-full bg-success/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute bottom-[-140px] left-[-80px] size-[360px] rounded-full bg-accent/20 blur-3xl"
        />

        <Link to="/" className="relative w-fit shrink-0" aria-label="LedgerMind, accueil">
          <Wordmark onInk />
        </Link>

        <div className="relative my-12 max-w-md">
          <p className="rule-label mb-4 text-accent">Espace membre</p>
          <blockquote className="text-balance text-2xl leading-snug md:text-3xl">
            « LedgerMind a transformé ma gestion d&apos;auto-entrepreneur en{" "}
            <span className="font-normal italic text-accent">un jeu d&apos;enfant.</span> »
          </blockquote>
          <p className="mt-6 text-sm font-medium text-ink-foreground/60">
            Clara V. — Créatrice de contenu &amp; Designer
          </p>
        </div>

        <p className="rule-label relative text-ink-foreground/40">© 2026 LedgerMind</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-10 md:py-16">
        <section className="animate-rise w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <p className="rule-label text-accent-ink">
              {isLogin ? "Connexion" : "Nouveau compte"}
            </p>
            <span className="rule-label text-muted-foreground">
              {isLogin ? "01 / 02" : "02 / 02"}
            </span>
          </div>

          <h2 className="text-balance text-3xl md:text-4xl">
            {isLogin ? (
              <>
                Ravi de vous <span className="font-normal italic">revoir.</span>
              </>
            ) : (
              <>
                Rejoignez <span className="font-normal italic">LedgerMind.</span>
              </>
            )}
          </h2>
          <p className="mt-3 text-pretty text-sm text-muted-foreground">
            {isLogin
              ? "Saisissez vos identifiants pour accéder à votre espace."
              : "Créez votre compte pour commencer à automatiser vos obligations."}
          </p>

          <div className="relative mt-8 grid grid-cols-2 rounded-full border border-border bg-card p-1 text-xs font-medium">
            <div
              className={cn(
                "absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-primary transition-transform duration-300 ease-out",
                isLogin ? "translate-x-1" : "translate-x-[calc(100%+4px)]",
              )}
            />
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={cn(
                "relative z-10 rounded-full py-2 transition-colors duration-200",
                isLogin ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={cn(
                "relative z-10 rounded-full py-2 transition-colors duration-200",
                !isLogin ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-5">
            {!isLogin && (
              <Field
                label="Nom complet"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Alexandre Martin"
                required
              />
            )}
            <Field
              label="Adresse email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="vous@exemple.fr"
              required
            />
            <Field
              label="Mot de passe"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder="••••••••"
              hint={!isLogin ? "6 caractères minimum" : undefined}
              minLength={6}
              required
            />

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Un instant…</span>
                </>
              ) : (
                <>
                  {isLogin ? "Se connecter" : "Créer mon compte"}
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </button>
          </form>

          <div className="my-8 flex items-center gap-4">
            <div className="dotted-divider flex-1" />
            <span className="rule-label text-muted-foreground">ou</span>
            <div className="dotted-divider flex-1" />
          </div>

          <button
            type="button"
            disabled
            title="Bientôt disponible"
            className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-border bg-card py-2.5 text-sm font-medium opacity-50"
          >
            <GoogleIcon />
            Continuer avec Google (bientôt)
          </button>

          <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
            En continuant, vous acceptez nos{" "}
            <a href="#" className="underline underline-offset-2 transition-colors hover:text-foreground">
              Conditions
            </a>{" "}
            et notre{" "}
            <a href="#" className="underline underline-offset-2 transition-colors hover:text-foreground">
              Politique de confidentialité
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  name,
  ...rest
}: {
  label: string;
  hint?: string;
  name: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="rule-label text-muted-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <input
        {...rest}
        name={name}
        className="w-full border-b border-border bg-transparent py-2.5 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-ink focus:outline-none"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.4z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.7 0 20.2 0 24s1 7.3 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.6-5.9c-2.1 1.4-4.8 2.3-7.4 2.3-6.3 0-11.6-3.9-13.5-9.4l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
