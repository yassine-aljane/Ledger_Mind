import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — connexion" },
      {
        name: "description",
        content: "Connectez-vous ou créez votre compte LedgerMind.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Static front — no backend yet; continue into the product flow.
    void navigate({ to: "/onboarding" });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 h-16 flex items-center max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-full bg-teal-dark" />
          <span className="font-semibold tracking-tight uppercase text-sm">LedgerMind</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-16">
        <section className="w-full max-w-md animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-6">
            Compte · {mode === "login" ? "Connexion" : "Inscription"}
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance leading-[1.05]">
            {mode === "login" ? (
              <>
                Bon retour <span className="italic font-normal">parmi nous.</span>
              </>
            ) : (
              <>
                Créez votre <span className="italic font-normal">espace fiscal.</span>
              </>
            )}
          </h1>
          <p className="mt-4 text-ink/60 text-pretty">
            {mode === "login"
              ? "Accédez à votre tableau de bord, vos documents et votre provision."
              : "Quelques secondes pour démarrer. Vous pourrez compléter votre profil ensuite."}
          </p>

          <div className="mt-8 flex gap-2 p-1 rounded-xl bg-secondary">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={
                mode === "login"
                  ? "flex-1 py-2.5 rounded-lg text-sm font-semibold bg-background text-ink shadow-sm"
                  : "flex-1 py-2.5 rounded-lg text-sm font-medium text-ink/50 hover:text-ink transition-colors"
              }
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={
                mode === "signup"
                  ? "flex-1 py-2.5 rounded-lg text-sm font-semibold bg-background text-ink shadow-sm"
                  : "flex-1 py-2.5 rounded-lg text-sm font-medium text-ink/50 hover:text-ink transition-colors"
              }
            >
              Inscription
            </button>
          </div>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <label className="block">
                <span className="text-[13px] font-medium text-ink/70">Prénom</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alexandre"
                  className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-teal-dark transition-colors"
                />
              </label>
            )}
            <label className="block">
              <span className="text-[13px] font-medium text-ink/70">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-teal-dark transition-colors"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-ink/70">Mot de passe</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-teal-dark transition-colors"
              />
            </label>

            <button
              type="submit"
              className="w-full mt-2 px-6 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
            >
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-ink/40">
            Front statique — aucune auth réelle pour l’instant. Le formulaire envoie vers
            l’onboarding pour tester le parcours.
          </p>
        </section>
      </main>
    </div>
  );
}
