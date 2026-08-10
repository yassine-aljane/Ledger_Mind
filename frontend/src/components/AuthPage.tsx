import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Calculator,
  Globe2,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  fetchMe,
  getStoredUser,
  isAuthed,
  loginAccount,
  registerAccount,
  type AuthUser,
} from "@/lib/auth";
import { accessState, isParcoursDone, landingPathFor } from "@/lib/entitlements";
import { consumePremiumPending, getPlan } from "@/lib/plan";
import { AnimatedWordmark, Mark } from "@/components/lm/Logo";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formFocused, setFormFocused] = useState(false);

  useEffect(() => {
    if (!isAuthed()) return;
    const cached = getStoredUser();
    if (cached) {
      navigate({ to: destinationApres(cached), replace: true });
      return;
    }
    fetchMe()
      .then((u) => navigate({ to: destinationApres(u), replace: true }))
      .catch(() => navigate({ to: "/education", replace: true }));
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
      navigate({ to: destinationApres(res.user), replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'authentification.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Où envoyer l'utilisateur juste après authentification.
   *
   * Une activation Premium demandée alors qu'il était déconnecté est honorée ICI, avant de
   * calculer la destination : la formule est attachée à un compte, elle ne pouvait donc pas être
   * posée au moment du clic. L'ordre compte — activer après aurait envoyé vers /education un
   * utilisateur qui vient pourtant de passer Premium.
   */
  function destinationApres(user: AuthUser): string {
    consumePremiumPending();
    return landingPathFor(accessState(true, getPlan(), isParcoursDone(user)));
  }

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(430px,0.85fr)]">
      <aside
        className="relative min-h-[320px] overflow-hidden text-ink-foreground lg:min-h-screen"
        style={{
          background:
            "radial-gradient(circle at 22% 16%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 32%), linear-gradient(145deg, color-mix(in oklab, var(--primary) 84%, white), color-mix(in oklab, var(--ink) 82%, var(--teal-light)))",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "25px 25px",
          }}
        />
        <div
          aria-hidden
          className="lm-auth-glow absolute -left-24 -top-24 size-72 rounded-full bg-accent/25 blur-3xl"
        />
        <div
          aria-hidden
          className="lm-auth-glow lm-auth-glow--late absolute -bottom-32 -right-20 size-80 rounded-full bg-teal/25 blur-3xl"
        />
        <div className="relative z-10 flex min-h-[320px] flex-col px-6 py-6 sm:px-10 sm:py-8 lg:min-h-screen lg:px-14 lg:py-10 xl:px-20">
          <Link
            to="/"
            className="lm-auth-logo-link w-fit rounded-full border border-white/12 bg-white/6 px-3 py-2 backdrop-blur-sm transition-colors hover:bg-white/10"
            aria-label="LedgerMind, accueil"
          >
            <AnimatedWordmark onInk className="w-auto" />
          </Link>

          <div className="my-auto flex flex-col items-center py-8 text-center">
            <div
              className={cn(
                "lm-auth-orbit-stage relative size-44 sm:size-56 lg:size-64",
                formFocused && "lm-auth-orbit-stage--active",
              )}
              role="img"
              aria-label="Globe LedgerMind avec une clé et une calculatrice en orbite"
            >
              <div aria-hidden className="lm-auth-orbit-track lm-auth-orbit-track--key">
                <span className="lm-auth-orbit-ring" />
                <span className="lm-auth-orbit-node">
                  <span className="lm-auth-orbit-icon">
                    <KeyRound className="size-5 text-accent" />
                  </span>
                </span>
              </div>

              <div aria-hidden className="lm-auth-orbit-track lm-auth-orbit-track--calculator">
                <span className="lm-auth-orbit-ring" />
                <span className="lm-auth-orbit-node">
                  <span className="lm-auth-orbit-icon">
                    <Calculator className="size-5 text-white/90" />
                  </span>
                </span>
              </div>

              <div
                className={cn(
                  "relative z-10 grid size-full place-items-center overflow-hidden rounded-full border border-white/25 bg-white/10 shadow-[inset_-24px_-24px_50px_rgba(0,0,0,0.22),0_25px_70px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-500",
                  formFocused &&
                    "scale-105 border-accent/70 bg-white/15 shadow-[0_0_48px_color-mix(in_oklab,var(--accent)_30%,transparent)]",
                )}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_34%_26%,color-mix(in_oklab,var(--accent)_28%,transparent),transparent_48%)]" />
                <Globe2
                  className="lm-auth-globe-lines absolute size-[88%] text-accent/30"
                  strokeWidth={0.85}
                />
                <div className="relative z-10 grid size-28 place-items-center rounded-[2.25rem] border border-white/20 bg-ink/75 shadow-[0_16px_40px_rgba(0,0,0,0.30)] backdrop-blur-md sm:size-36 lg:size-40">
                  <Mark className="size-[5.5rem] sm:size-28 lg:size-32" />
                </div>
              </div>
            </div>

            <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              LedgerMind
            </p>
            <h1 className="mt-2 max-w-lg font-display text-3xl font-semibold leading-tight text-white sm:text-4xl xl:text-5xl">
              Create more,
              <span className="block font-normal italic text-accent">Stress less.</span>
            </h1>
          </div>

          <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">
            © 2026 LedgerMind
          </p>
        </div>
      </aside>

      <main
        className="relative flex min-h-screen items-stretch overflow-hidden px-5 py-10 sm:px-8 lg:px-10 lg:py-14"
        style={{
          background:
            "linear-gradient(145deg, color-mix(in oklab, var(--card) 82%, white), color-mix(in oklab, var(--parchment) 88%, var(--accent)))",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          aria-hidden
          className="absolute -right-24 top-1/4 size-72 rounded-full bg-accent/10 blur-3xl"
        />

        <section className="animate-rise relative z-10 flex w-full flex-col justify-center px-1 sm:px-6 lg:px-[8%] xl:px-[12%]">
          <div
            aria-hidden
            className="absolute bottom-[12%] left-0 top-[12%] hidden w-px bg-gradient-to-b from-transparent via-accent/55 to-transparent lg:block"
          />
          <div key={mode} className="animate-rise flex items-start gap-4">
            <Mark className="mt-0.5 size-11 shrink-0" />
            <div>
              <p className="rule-label text-accent-ink">
                {isLogin ? "Connexion" : "Inscription"}
              </p>
              <h2 className="mt-2 text-balance text-3xl md:text-4xl">
                {isLogin ? "Bon retour." : "Créez votre espace."}
              </h2>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                {isLogin
                  ? "Connectez-vous et continuez là où vous vous êtes arrêté."
                  : "Quelques secondes suffisent pour commencer avec LedgerMind."}
              </p>
            </div>
          </div>

          <div className="relative mt-8 grid grid-cols-2 rounded-full border border-border bg-secondary/60 p-1 text-xs font-medium">
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

          <form
            onSubmit={(e) => void handleSubmit(e)}
            onFocusCapture={() => setFormFocused(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFormFocused(false);
            }}
            className="mt-8 space-y-5"
          >
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
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-sm font-semibold text-accent-foreground shadow-soft transition-all duration-200 hover:brightness-[1.04] hover:shadow-lift active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Un instant…</span>
                </>
              ) : (
                <>
                  {isLogin ? "Accéder à mon espace" : "Créer mon espace"}
                  <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </button>

            <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-success-ink" />
              Connexion protégée
            </p>
          </form>

          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
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
        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-all duration-200 placeholder:text-muted-foreground/55 focus:border-primary/55 focus:outline-none focus:ring-4 focus:ring-primary/8"
      />
    </label>
  );
}
