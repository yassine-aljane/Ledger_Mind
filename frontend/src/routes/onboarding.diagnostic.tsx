import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
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

  return <DiagnosticChat />;
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
        <Link to="/onboarding" className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink transition-colors duration-200">
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      {!started ? (
        <section className="mt-16 max-w-2xl mx-auto text-center animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-6">
            Étape 02 · Diagnostic
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-balance">
            On va faire le point,{" "}
            <span className="italic font-normal">ensemble.</span>
          </h1>
          <p className="mt-8 text-lg text-ink/60 text-pretty">
            Aucun jugement, aucun jargon. Quelques questions simples pour comprendre où vous en
            êtes et vous proposer la meilleure marche à suivre pour devenir légal et actif.
          </p>

          <div className="mt-12 grid sm:grid-cols-3 gap-4 text-left">
            {[
              { n: "0", l: "formulaire à remplir" },
              { n: "3 min", l: "de discussion" },
              { n: "1", l: "feuille de route" },
            ].map((s) => (
              <div key={s.l} className="bg-white border border-border rounded-2xl p-6 card-hover">
                <p className="font-mono text-2xl font-medium text-teal-dark">{s.n}</p>
                <p className="text-sm text-ink/60 mt-1">{s.l}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStarted(true)}
            className="mt-12 px-10 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
          >
            Commencer le diagnostic
          </button>
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
                  className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 active:scale-[0.97] ${
                    actif
                      ? "bg-ink text-background"
                      : "bg-white border border-border text-ink/60 hover:border-teal-dark hover:text-teal-dark"
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>

          <header className="mt-8 mb-8 animate-slide-up">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tighter text-balance">
              {actuel.titre}
            </h1>
            <p className="mt-2 text-ink/60 text-pretty max-w-2xl">{actuel.sous}</p>
          </header>

          {espace === "guidance" ? <GuidanceChat /> : <FiscalAssistant />}
        </div>
      )}
    </div>
  );
}
