import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CloudOff, Save } from "lucide-react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FiscalAssistant } from "@/components/lm/FiscalAssistant";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/entitlements";

export const Route = createFileRoute("/education")({
  head: () => ({
    meta: [
      { title: "Assistant fiscal — LedgerMind" },
      {
        name: "description",
        content:
          "Posez une question fiscale. Réponses en français simple, ancrées sur BOFiP, Légifrance et URSSAF.",
      },
      { property: "og:title", content: "Assistant fiscal — LedgerMind" },
      {
        property: "og:description",
        content:
          "Posez une question fiscale. Réponses en français simple, ancrées sur BOFiP, Légifrance et URSSAF.",
      },
    ],
  }),
  component: EducationPage,
});

function BandeauContexte() {
  const { state, loading } = useEntitlements();
  if (loading || state === "premium_complet" || state === "premium_parcours") return null;

  if (state === "invite") {
    return (
      <div className="animate-rise mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-soft sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
            <CloudOff className="size-3.5" />
          </span>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Sans compte</span> — la conversation reste
            sur ce navigateur.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 rounded-full">
          <Link to="/auth">
            Créer un compte <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-rise mb-6 flex flex-col gap-3 overflow-hidden rounded-2xl bg-ink px-4 py-3.5 text-ink-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ink-foreground/10 text-accent">
          <Save className="size-3.5" />
        </span>
        <p className="text-sm leading-relaxed text-ink-foreground/70">
          <span className="font-medium text-ink-foreground">Historique sauvé</span> — Premium pour
          passer à l&apos;action.
        </p>
      </div>
      <Button asChild size="sm" variant="accent" className="shrink-0 rounded-full">
        <Link to="/premium">Découvrir Premium</Link>
      </Button>
    </div>
  );
}

function EducationPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Assistant fiscal"
        title={
          <>
            Posez.{" "}
            <span className="italic font-normal text-accent-ink">On cite les textes.</span>
          </>
        }
        description="Réponses en français simple, ancrées sur BOFiP, Légifrance et URSSAF."
      />
      <BandeauContexte />
      <FiscalAssistant />
    </AppShell>
  );
}
