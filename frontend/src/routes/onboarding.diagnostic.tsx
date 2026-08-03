import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { LogoutBubble } from "@/components/lm/AppShell";
import { Wordmark } from "@/components/lm/Logo";
import { Button } from "@/components/ui/button";
import { FiscalAssistant } from "@/components/lm/FiscalAssistant";
import { GuidanceChat } from "@/components/lm/GuidanceChat";

type Espace = "guidance" | "pedagogue";

const ESPACES: { id: Espace; label: string; titre: string; sous: string }[] = [
  {
    id: "guidance",
    label: "Guidance",
    titre: "Chatbot de guidance",
    sous: "Décrivez votre activité : je vous profile pas à pas, puis je construis votre feuille de route personnalisée.",
  },
  {
    id: "pedagogue",
    label: "Assistant fiscal",
    titre: "Assistant fiscal",
    sous: "Posez vos questions sur la fiscalité, les obligations, les seuils — réponses ancrées sur les sources officielles.",
  },
];

export const Route = createFileRoute("/onboarding/diagnostic")({
  head: () => ({
    meta: [
      { title: "Diagnostic de régularisation — LedgerMind" },
      {
        name: "description",
        content: "Un diagnostic guidé pour clarifier votre situation, sans jugement.",
      },
      { property: "og:title", content: "Diagnostic de régularisation — LedgerMind" },
      {
        property: "og:description",
        content: "Un diagnostic guidé pour clarifier votre situation, sans jugement.",
      },
    ],
  }),
  component: DiagnosticPage,
});

function DiagnosticPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Child route `/resultat` must render through Outlet — otherwise the page stays blank
  if (pathname.includes("/resultat")) {
    return <Outlet />;
  }

  // Seule l'étape de diagnostic est refermée une fois le parcours instruit ; la feuille de
  // route, elle, passe par l'Outlet ci-dessus et porte sa propre barrière (feature "roadmap").
  return (
    <AccessGate feature="onboarding">
      <DiagnosticChat />
    </AccessGate>
  );
}

function DiagnosticChat() {
  // Le diagnostic est CONVERSATIONNEL : la session est créée par le premier message, il n'y a
  // donc rien à démarrer côté serveur avant d'entrer dans la discussion.
  const [started, setStarted] = useState(false);
  const [espace, setEspace] = useState<Espace>("guidance");
  const actuel = ESPACES.find((e) => e.id === espace) ?? ESPACES[0];

  return (
    <div className="min-h-screen px-6 py-16 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link to="/" aria-label="LedgerMind, accueil">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/onboarding"
            className="rule-label text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            ← Retour
          </Link>
          <LogoutBubble />
        </div>
      </div>

      {!started ? (
        <section className="mt-16 max-w-2xl mx-auto text-center animate-rise">
          <p className="rule-label mb-6 text-accent-ink">
            Étape 02 · Diagnostic
          </p>
          <h1 className="text-balance text-4xl md:text-5xl">
            On va faire le point,{" "}
            <span className="italic font-normal">ensemble.</span>
          </h1>
          <p className="mt-8 text-lg text-muted-foreground text-pretty">
            Aucun jugement, aucun jargon. Quelques questions simples pour comprendre où vous en
            êtes et vous proposer la meilleure marche à suivre pour devenir légal et actif.
          </p>

          <div className="mt-12 grid sm:grid-cols-3 gap-4 text-left">
            {[
              { n: "0", l: "formulaire à remplir" },
              { n: "3 min", l: "de discussion" },
              { n: "1", l: "feuille de route" },
            ].map((s) => (
              <div key={s.l} className="card-hover rounded-2xl border border-border bg-card p-6 shadow-soft">
                <p className="num text-2xl font-medium text-primary">{s.n}</p>
                <p className="text-sm text-muted-foreground mt-1">{s.l}</p>
              </div>
            ))}
          </div>

          <Button size="lg" variant="accent" className="mt-12" onClick={() => setStarted(true)}>
            Commencer le diagnostic
          </Button>
        </section>
      ) : (
        <div className="mt-12">
          {/* Les deux espaces du parcours « pas encore immatriculé », accessibles sans SIREN :
              la guidance construit la feuille de route, l'assistant fiscal répond aux questions
              ponctuelles. Le profil et la mémoire sont partagés côté serveur — changer d'onglet
              ne perd rien. */}
          <div className="flex flex-wrap items-center gap-2">
            {ESPACES.map((e) => {
              const actif = espace === e.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setEspace(e.id)}
                  className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.97] ${
                    actif
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "border border-border bg-card text-muted-foreground hover:border-ink hover:text-foreground"
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>

          <header className="mt-8 mb-8 animate-rise">
            <h1 className="text-balance text-3xl md:text-4xl">
              {actuel.titre}
            </h1>
            <p className="mt-2 text-muted-foreground text-pretty max-w-2xl">{actuel.sous}</p>
          </header>

          {espace === "guidance" ? <GuidanceChat /> : <FiscalAssistant />}
        </div>
      )}
    </div>
  );
}
