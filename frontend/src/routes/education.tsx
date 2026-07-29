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

      <p className="max-w-2xl text-sm text-ink/60 leading-relaxed mb-8">
        Posez votre question en français courant. Les réponses s&apos;appuient sur le corpus
        officiel (Légifrance, BOFiP, URSSAF, impots.gouv.fr) et citent leurs sources. Si
        l&apos;information n&apos;y figure pas, l&apos;assistant le dit plutôt que de l&apos;inventer.
      </p>

      <FiscalAssistant />
    </AppShell>
  );
}
