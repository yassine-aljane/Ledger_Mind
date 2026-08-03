import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Wordmark } from "@/components/logo";
import { Button, Field, Input, Spinner } from "@/components/ui-kit";
import { useAuth, postAuthPath } from "@/lib/auth";
import { ApiError, consumePendingPremium } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion & inscription — LedgerMind" },
      {
        name: "description",
        content:
          "Créez un compte Free pour votre profil et l'Éducation fiscale, ou connectez-vous. Premium débloque le parcours d'action.",
      },
      { property: "og:title", content: "Connexion & inscription — LedgerMind" },
      { property: "og:description", content: "Accédez à votre copilote fiscal LedgerMind." },
    ],
  }),
  component: AuthPage,
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom (2 caractères minimum).").max(80),
  email: z.string().trim().email("Adresse email invalide.").max(255),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères.").max(128),
});

const loginSchema = registerSchema.pick({ email: true, password: true });

function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { signIn, signUp, activatePremium } = useAuth();
  const navigate = useNavigate();

  const isLogin = mode === "login";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const schema = mode === "register" ? registerSchema : loginSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (map[String(i.path[0])] = i.message));
      setErrors(map);
      return;
    }

    setBusy(true);
    try {
      const user =
        mode === "register"
          ? await signUp(values.email.trim(), values.password, values.name.trim())
          : await signIn(values.email.trim(), values.password);

      if (consumePendingPremium()) {
        try {
          const upgraded = await activatePremium();
          toast.success("Premium activé. Choisissez votre parcours : avec ou sans SIRET.");
          navigate({ to: postAuthPath({ ...upgraded, subscription_tier: "premium" }) });
          return;
        } catch (err) {
          const message =
            err instanceof ApiError ? err.message : "Activation Premium impossible pour le moment.";
          toast.error(message);
          setErrors({ form: message });
          navigate({ to: "/abonnement" });
          return;
        }
      }

      toast.success(mode === "register" ? "Bienvenue sur LedgerMind." : "Content de vous revoir.");
      navigate({ to: postAuthPath(user) });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Une erreur inattendue est survenue. Réessayez.";
      toast.error(message);
      setErrors({ form: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* -------- Panneau coloré -------- */}
      <aside className="surface-ink relative flex flex-col justify-between overflow-hidden px-8 py-10 text-ink-foreground md:w-[46%] md:px-14 md:py-14">
        <div className="surface-grain pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full bg-accent/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute bottom-[-140px] left-[-80px] size-[360px] rounded-full bg-accent/25 blur-3xl"
          aria-hidden
        />

        <Link to="/" className="relative w-fit shrink-0">
          <Wordmark onInk />
        </Link>

        <div className="relative my-12 max-w-md">
          <p className="rule-label mb-4 text-accent">Espace membre</p>
          <blockquote className="text-balance text-2xl font-semibold leading-snug tracking-tight md:text-3xl">
            « LedgerMind a transformé ma gestion d&apos;auto-entrepreneur en{" "}
            <span className="italic font-normal text-safran">un jeu d&apos;enfant.</span> »
          </blockquote>
          <p className="mt-6 text-sm font-medium text-ink-foreground/60">
            Clara V. — Créatrice de contenu &amp; Designer
          </p>
        </div>

        <p className="relative font-mono text-[11px] uppercase tracking-widest text-ink-foreground/40">
          © 2026 LedgerMind
        </p>
      </aside>

      {/* -------- Formulaire -------- */}
      <main className="flex flex-1 items-center justify-center bg-background px-6 py-10 md:py-16">
        <section className="animate-rise w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <p className="rule-label text-accent-foreground">
              {isLogin ? "Connexion" : "Nouveau compte"}
            </p>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              {isLogin ? "01 / 02" : "02 / 02"}
            </span>
          </div>

          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            {isLogin ? (
              <>
                Ravi de vous <span className="italic font-normal text-safran">revoir.</span>
              </>
            ) : (
              <>
                Rejoignez <span className="italic font-normal text-safran">LedgerMind.</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-pretty text-sm text-muted-foreground">
            {isLogin
              ? "Saisissez vos identifiants pour accéder à votre espace."
              : "Créez votre compte pour commencer à automatiser vos obligations."}
          </p>

          <div className="relative mt-8 grid grid-cols-2 rounded-full border border-border bg-card p-1 text-xs font-semibold">
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
                setErrors({});
              }}
              className={cn(
                "relative z-10 rounded-full py-2.5 transition-colors",
                isLogin ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setErrors({});
              }}
              className={cn(
                "relative z-10 rounded-full py-2.5 transition-colors",
                !isLogin ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            {!isLogin && (
              <Field label="Nom complet" htmlFor="name" error={errors.name}>
                <Input
                  id="name"
                  autoComplete="name"
                  value={values.name}
                  onChange={set("name")}
                  placeholder="Alexandre Martin"
                />
              </Field>
            )}
            <Field label="Adresse email" htmlFor="email" error={errors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={set("email")}
                placeholder="vous@exemple.fr"
              />
            </Field>
            <Field
              label="Mot de passe"
              htmlFor="password"
              error={errors.password}
              hint={!isLogin ? "6 caractères minimum" : undefined}
            >
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={values.password}
                onChange={set("password")}
                placeholder="••••••••"
              />
            </Field>

            {errors.form && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
              >
                {errors.form}
              </p>
            )}

            <Button type="submit" variant="primary" className="mt-2 w-full" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Un instant…" : isLogin ? "Se connecter" : "Créer mon compte"}
              {!busy && <span aria-hidden>→</span>}
            </Button>
          </form>

          <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
            En continuant, vous acceptez nos Conditions et notre Politique de confidentialité.
          </p>
        </section>
      </main>
    </div>
  );
}
