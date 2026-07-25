import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "LedgerMind — Connexion & inscription" },
      {
        name: "description",
        content:
          "Accédez à votre espace LedgerMind — l'assistant fiscal des freelances et créateurs français.",
      },
      { property: "og:title", content: "LedgerMind — Connexion & inscription" },
      {
        property: "og:description",
        content: "Connectez-vous ou créez votre compte LedgerMind en 30 secondes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    // Frontend-only: simulate auth then continue to onboarding gate.
    setTimeout(() => {
      try {
        localStorage.setItem("lm.session", "1");
      } catch {
        /* noop */
      }
      navigate({ to: "/" });
    }, 550);
  }

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Left — editorial side */}
      <aside className="relative md:w-[46%] bg-ink text-background overflow-hidden flex flex-col justify-between px-8 md:px-14 py-10 md:py-14">
        <div aria-hidden className="absolute inset-0 grain-overlay opacity-[0.06]" />
        <div aria-hidden className="absolute -top-24 -right-24 size-[420px] rounded-full bg-teal-dark/40 blur-3xl" />
        <div aria-hidden className="absolute bottom-[-140px] left-[-80px] size-[360px] rounded-full bg-amber-fiscal/25 blur-3xl" />

        <Link to="/" className="relative flex items-center gap-2 shrink-0 w-fit">
          <div className="size-6 rounded-full bg-teal-light" />
          <span className="font-semibold tracking-tight uppercase text-sm">LedgerMind</span>
        </Link>

        <div className="relative">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-light/90 mb-6">
            Étape 00 · Votre espace privé
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-[1.02] text-balance">
            L'assistant fiscal <span className="italic font-normal text-teal-light">qui parle humain.</span>
          </h1>
          <p className="mt-6 text-base md:text-lg text-background/70 max-w-md text-pretty">
            Chiffrez, comprenez et provisionnez vos impôts sans jargon. Créé pour les freelances,
            créateurs et micro-entrepreneurs français.
          </p>

          <ul className="mt-10 space-y-3 text-sm text-background/80">
            {[
              "Diagnostic fiscal en 2 minutes",
              "Reçu clair de vos provisions mensuelles",
              "Simulateur temps réel BNC, BIC, micro",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="size-1.5 rounded-full bg-teal-light" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative dotted-divider opacity-30" />
        <p className="relative text-[11px] uppercase tracking-widest text-background/40 font-mono">
          © 2026 LedgerMind
        </p>
      </aside>

      {/* Right — form side */}
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
                Créons votre <span className="italic font-normal">espace.</span>
              </>
            )}
          </h2>
          <p className="mt-3 text-sm text-ink/60">
            {isLogin
              ? "Connectez-vous pour retrouver vos provisions et votre diagnostic."
              : "30 secondes suffisent. Aucune carte bancaire demandée."}
          </p>

          {/* Segmented switch */}
          <div className="mt-8 relative grid grid-cols-2 rounded-full border border-border bg-secondary/60 p-1 text-sm font-medium">
            <span
              aria-hidden
              className="absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-ink transition-transform duration-300 ease-out"
              style={{ transform: isLogin ? "translateX(4px)" : "translateX(calc(100% + 4px))" }}
            />
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`relative z-10 py-2.5 rounded-full transition-colors ${
                isLogin ? "text-background" : "text-ink/60"
              }`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
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
              hint={!isLogin ? "8 caractères minimum" : undefined}
              required
            />

            {isLogin && (
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 text-ink/60 cursor-pointer">
                  <input type="checkbox" className="size-3.5 accent-teal-dark" defaultChecked />
                  Se souvenir de moi
                </label>
                <button
                  type="button"
                  className="font-medium text-teal-dark hover:underline underline-offset-4"
                >
                  Mot de passe oublié ?
                </button>
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

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="flex-1 dotted-divider" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
              ou
            </span>
            <div className="flex-1 dotted-divider" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <OAuthButton label="Google" />
            <OAuthButton label="Apple" />
          </div>

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

function OAuthButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex items-center justify-center gap-2 py-3 rounded-xl border border-border bg-background hover:border-ink transition-colors text-sm font-medium"
    >
      <span className="size-4 rounded-full bg-ink/80" aria-hidden />
      {label}
    </button>
  );
}
