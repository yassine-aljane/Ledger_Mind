import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — Connexion & inscription" },
      {
        name: "description",
        content:
          "Accédez à votre espace LedgerMind — l'assistant fiscal des freelances et créateurs français.",
      },
    ],
  }),
  component: AuthPage,
});

