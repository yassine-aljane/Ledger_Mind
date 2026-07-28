import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type Mode = "login" | "signup";

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // If already signed in, skip straight to onboarding.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/onboarding", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/onboarding", replace: true });
        } else {
          setInfo("Compte créé. Vérifiez votre email pour confirmer votre inscription.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/onboarding", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Une erreur est survenue.";
      setError(translateError(msg));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(translateError(result.error.message ?? "Google indisponible."));
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/onboarding", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur Google.");
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="relative md:w-[46%] bg-ink text-background overflow-hidden flex flex-col justify-between px-8 md:px-14 py-10 md:py-14">
        <div aria-hidden className="absolute inset-0 grain-overlay opacity-[0.06]" />
        <div aria-hidden className="absolute -top-24 -right-24 size-[420px] rounded-full bg-teal-dark/40 blur-3xl" />
        <div aria-hidden className="absolute bottom-[-140px] left-[-80px] size-[360px] rounded-full bg-amber-fiscal/25 blur-3xl" />

        <Link to="/" className="relative flex items-center gap-2 shrink-0 w-fit">
          <div className="size-6 rounded-full bg-teal-light" />
          <span className="font-semibold tracking-tight uppercase text-sm">LedgerMind</span>
        </Link>

        <div className="relative my-12 max-w-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-teal-light mb-4">
            Espace membre
          </p>
          <blockquote className="text-2xl md:text-3xl font-extrabold tracking-tight text-balance leading-snug">
            « LedgerMind a transformé ma gestion d'auto-entrepreneur en{" "}
            <span className="italic font-normal">un jeu d'enfant.</span> »
          </blockquote>
          <p className="mt-6 text-sm text-background/60 font-medium">
            Clara V. — Créatrice de contenu & Designer
          </p>
        </div>

        <p className="relative text-[11px] uppercase tracking-widest text-background/40 font-mono">
          © 2026 LedgerMind
        </p>
      </aside>

      <main className="flex-1 flex items-center justify-center px-6 py-10 md:py-16">
        <section className="w-full max-w-md animate-slide-up">
          <div className="flex items-center justify-between mb-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
              {isLogin ? "Connexion" : "Nouveau compte"}
            </p>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/40">
              {isLogin ? "01 / 02" : "02 / 02"}
            </span>
          </div>

          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tighter text-balance">
            {isLogin ? (
              <>
                Ravi de vous <span className="italic font-normal">revoir.</span>
              </>
            ) : (
              <>
                Rejoignez <span className="italic font-normal">LedgerMind.</span>
              </>
            )}
          </h2>
          <p className="mt-3 text-ink/60 text-sm text-pretty">
            {isLogin
              ? "Saisissez vos identifiants pour accéder à votre espace."
              : "Créez votre compte pour commencer à automatiser vos obligations."}
          </p>

          <div className="mt-8 relative grid grid-cols-2 p-1 bg-white border border-border rounded-full text-xs font-semibold">
            <div
              className={`absolute inset-y-1 w-[calc(50%-4px)] bg-ink rounded-full transition-transform duration-300 ease-out ${
                isLogin ? "translate-x-1" : "translate-x-[calc(100%+4px)]"
              }`}
            />
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
                setInfo(null);
              }}
              className={`relative z-10 py-2.5 rounded-full transition-colors ${
                isLogin ? "text-background" : "text-ink/60"
              }`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setInfo(null);
              }}
              className={`relative z-10 py-2.5 rounded-full transition-colors ${
                !isLogin ? "text-background" : "text-ink/60"
              }`}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
              <div className="rounded-lg border border-amber-fiscal/40 bg-amber-fiscal/10 px-3 py-2 text-xs text-ink/80">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-lg border border-teal-dark/30 bg-teal-light/20 px-3 py-2 text-xs text-ink/80">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="size-2 rounded-full bg-background/70 animate-pulse" />
                  <span>Un instant…</span>
                </>
              ) : (
                <>
                  {isLogin ? "Se connecter" : "Créer mon compte"}
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
          </form>

          <div className="my-8 flex items-center gap-4">
            <div className="flex-1 dotted-divider" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
              ou
            </span>
            <div className="flex-1 dotted-divider" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-border bg-background hover:border-ink transition-colors text-sm font-medium disabled:opacity-60"
          >
            <GoogleIcon />
            Continuer avec Google
          </button>

          <p className="mt-10 text-xs text-ink/50 text-center leading-relaxed">
            En continuant, vous acceptez nos{" "}
            <a href="#" className="underline underline-offset-2 hover:text-ink">
              Conditions
            </a>{" "}
            et notre{" "}
            <a href="#" className="underline underline-offset-2 hover:text-ink">
              Politique de confidentialité
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}

function translateError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Un compte existe déjà avec cet email. Connectez-vous.";
  if (m.includes("password") && m.includes("6")) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (m.includes("email") && m.includes("confirm")) return "Confirmez votre email avant de vous connecter.";
  return msg;
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
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/60">
          {label}
        </span>
        {hint && <span className="text-[11px] text-ink/40">{hint}</span>}
      </div>
      <input
        {...rest}
        name={name}
        className="w-full bg-transparent border-b border-ink/20 py-3 text-[15px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-teal-dark transition-colors"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.4z"/>
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.7 0 20.2 0 24s1 7.3 2.6 10.7l7.9-6.1z"/>
      <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.6-5.9c-2.1 1.4-4.8 2.3-7.4 2.3-6.3 0-11.6-3.9-13.5-9.4l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  );
}
