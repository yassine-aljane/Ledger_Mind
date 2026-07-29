import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FiscalAssistant } from "@/components/lm/FiscalAssistant";

export const Route = createFileRoute("/education")({
  head: () => ({
    meta: [
      { title: "Éducation fiscale — LedgerMind" },
      { name: "description", content: "Des fiches courtes, en français simple, pour tout comprendre." },
      { property: "og:title", content: "Éducation fiscale — LedgerMind" },
      {
        property: "og:description",
        content: "Des fiches courtes, en français simple, pour tout comprendre.",
      },
    ],
  }),
  component: EducationPage,
});

function EducationPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Éducation"
        title={
          <>
            Apprenez à votre rythme, <span className="italic font-normal">sans jargon.</span>
          </>
        }
      />

      <FiscalAssistant />
    </AppShell>
  );
}
