import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Chatbot, type ChatTurn } from "@/components/lm/Chatbot";
import { nextProfileQuestion } from "@/lib/api-mock";

export const Route = createFileRoute("/onboarding/profil")({
  head: () => ({
    meta: [
      { title: "Votre profil — LedgerMind" },
      { name: "description", content: "Quelques questions pour personnaliser votre suivi fiscal." },
      { property: "og:title", content: "Votre profil — LedgerMind" },
      {
        property: "og:description",
        content: "Quelques questions pour personnaliser votre suivi fiscal.",
      },
    ],
  }),
  component: ProfilPage,
});

function ProfilPage() {
  const [done, setDone] = useState<ChatTurn[] | null>(null);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen px-6 py-16 max-w-4xl mx-auto">
      <Link
        to="/onboarding/verification"
        className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink"
      >
        ← Retour
      </Link>

      <div className="mt-12">
        {!done ? (
          <Chatbot
            eyebrow="Construction du profil"
            fetchNext={nextProfileQuestion}
            onFinish={(t) => setDone(t)}
            intro="Quatre questions rapides pour adapter LedgerMind à votre activité."
          />
        ) : (
          <div className="max-w-2xl mx-auto animate-slide-up">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-teal-dark mb-4">
              Profil créé
            </p>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance">
              Tout est prêt, <span className="italic font-normal">Alexandre.</span>
            </h1>
            <p className="mt-4 text-lg text-ink/60 max-w-lg">
              Voici le résumé de vos réponses. Vous pourrez tout modifier plus tard dans vos
              paramètres.
            </p>

            <div className="mt-10 bg-white border border-border rounded-2xl divide-y divide-border">
              {done
                .filter((t) => t.role === "user")
                .map((t, i) => (
                  <div key={t.id} className="p-5 flex gap-4">
                    <span className="font-mono text-xs text-ink/40 pt-0.5">
                      {(i + 1).toString().padStart(2, "0")}
                    </span>
                    <p className="text-sm">{t.text}</p>
                  </div>
                ))}
            </div>

            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="mt-10 w-full px-8 py-5 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
            >
              Accéder à mon dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
