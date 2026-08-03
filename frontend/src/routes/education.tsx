import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CloudOff, Save, Sparkles } from "lucide-react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FiscalAssistant } from "@/components/lm/FiscalAssistant";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/entitlements";

export const Route = createFileRoute("/education")({
  head: () => ({
    meta: [
      { title: "Assistant fiscal — LedgerMind" },
      { name: "description", content: "Des fiches courtes, en français simple, pour tout comprendre." },
      { property: "og:title", content: "Assistant fiscal — LedgerMind" },
      {
        property: "og:description",
        content: "Des fiches courtes, en français simple, pour tout comprendre.",
      },
    ],
  }),
  component: EducationPage,
});

/**
 * Ce que change le fait d'avoir un compte, ici, concrètement.
 *
 * L'Éducation est ouverte à tous — mais sans compte, les échanges sont rattachés à un
 * identifiant anonyme propre au navigateur : ils disparaissent en changeant d'appareil ou en
 * vidant le stockage. Avec un compte, même gratuit, l'historique est rattaché à l'utilisateur
 * et le suit partout. C'est le bénéfice réel du palier connecté, et il mérite d'être dit
 * plutôt que découvert en perdant une conversation.
 */
function BandeauContexte() {
  const { state, loading } = useEntitlements();
  if (loading) return null;

  if (state === "invite") {
    return (
      <div className="animate-rise mb-8 flex flex-col justify-between gap-4 rounded-2xl border border-dashed border-border bg-card p-5 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <CloudOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Vos échanges ne sont pas conservés</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Sans compte, cette conversation reste attachée à ce navigateur : elle disparaîtra si
              vous changez d&apos;appareil. Le compte gratuit suffit à la retrouver.
            </p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/auth">
            Créer un compte gratuit <ArrowRight />
          </Link>
        </Button>
      </div>
    );
  }

  if (state === "free") {
    return (
      <div className="animate-rise mb-8 flex flex-col justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <Save className="mt-0.5 size-4 shrink-0 text-success-ink" />
          <div>
            <p className="text-sm font-medium">Vos conversations sont enregistrées</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Elles sont rattachées à votre compte : vous les retrouverez sur n&apos;importe quel
              appareil. Pour passer de comprendre à agir — diagnostic, échéances, documents —
              il faut la formule Premium.
            </p>
          </div>
        </div>
        <Button asChild variant="accent" className="shrink-0">
          <Link to="/premium">
            <Sparkles /> Découvrir Premium
          </Link>
        </Button>
      </div>
    );
  }

  return null;
}

function EducationPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Assistant fiscal"
        title={
          <>
            Apprenez à votre rythme, <span className="italic font-normal">sans jargon.</span>
          </>
        }
      />

      <BandeauContexte />
      <FiscalAssistant />
    </AppShell>
  );
}
