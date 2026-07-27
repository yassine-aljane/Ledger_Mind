import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";




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

