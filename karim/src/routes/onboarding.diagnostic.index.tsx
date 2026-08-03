import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { Button, ButtonLink, Card, ErrorBlock, Spinner } from "@/components/ui-kit";
import { CompletenessRail, KeyValueList, QuestionCard } from "@/components/orchestrator";
import { api, ApiError, detailAsTurn } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadSession, saveSession } from "@/lib/session-store";
import type { OrchestratorResponse } from "@/lib/types";

export const Route = createFileRoute("/onboarding/diagnostic/")({
  head: () => ({
    meta: [
      { title: "Diagnostic sans SIREN — LedgerMind" },
      {
        name: "description",
        content:
          "Pas encore immatriculé ? Répondez à quelques questions et obtenez votre régime, vos seuils et votre feuille de route.",
      },
      { property: "og:title", content: "Diagnostic sans SIREN — LedgerMind" },
      { property: "og:description", content: "Votre diagnostic fiscal en quelques minutes." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="onboarding"
      title="Diagnostic sans SIREN"
      pitch="Vous n'êtes pas encore immatriculé ? C'est justement le meilleur moment pour bien choisir."
      benefits={[
        "Diagnostic sans SIREN en 5 minutes",
        "Régime et catégorie fiscale déterminés selon vos réponses",
        "Feuille de route déterministe, sourcée et datée",
      ]}
      preview={
        <Card className="p-8">
          <p className="rule-label text-muted-foreground">Question de l'agent</p>
          <p className="mt-3 text-lg">Quel chiffre d'affaires annuel estimez-vous pour cette année ?</p>
        </Card>
      }
    >
      <Diagnostic />
    </PremiumGate>
  );
}

function Diagnostic() {
  const { refresh } = useAuth();
  const [state, setState] = useState<OrchestratorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function run(fn: () => Promise<OrchestratorResponse>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      saveSession("guidance", res.session_id);
      setState(res);
      if (res.ui_action === "show_roadmap") {
        await refresh();
        toast.success("Diagnostic terminé — votre feuille de route est prête.");
        navigate({ to: "/onboarding/diagnostic/resultat" });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Une erreur est survenue.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const existing = loadSession("guidance");
    if (!existing) return;
    void (async () => {
      try {
        const detail = await api.sessionDetail(existing);
        const turn = detailAsTurn(detail);
        setState(turn);
        if (turn.ui_action === "show_roadmap" || detail.roadmap) {
          navigate({ to: "/onboarding/diagnostic/resultat" });
        }
      } catch {
        /* session expirée : on repart de zéro */
      }
    })();
  }, [navigate]);

  const sessionId = state?.session_id ?? loadSession("guidance");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Parcours sans SIREN"
        title="Diagnostic guidé"
        description="Aucune immatriculation requise. Vos réponses construisent une feuille de route déterministe."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {error && <ErrorBlock message={error} />}

          {!state && (
            <Card className="animate-rise p-8">
              <h2 className="text-2xl">Prêt à démarrer ?</h2>
              <p className="mt-3 max-w-lg text-sm text-muted-foreground">
                Une dizaine de questions courtes sur votre activité, vos revenus estimés et votre
                ancienneté. Vous pouvez reprendre plus tard, la session est conservée.
              </p>
              <Button
                variant="safran"
                className="mt-6"
                disabled={busy}
                onClick={() => run(() => api.start({ branch: "guidance", skip_verification: true }))}
              >
                {busy && <Spinner />} Lancer mon diagnostic
              </Button>
            </Card>
          )}

          {state?.ui_action === "ask_question" && sessionId && (
            <QuestionCard
              message={state.message}
              quickReplies={state.quick_replies}
              busy={busy}
              onAnswer={(a) => run(() => api.turn({ session_id: sessionId, user_answer: a }))}
            />
          )}

          {state?.ui_action === "requires_expert" && (
            <Card className="animate-seal p-8">
              <h2 className="text-2xl">Un expert doit trancher</h2>
              <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
              <ButtonLink to="/referral" variant="safran" className="mt-6">
                Contacter des cabinets
              </ButtonLink>
            </Card>
          )}

          {state?.ui_action === "done" && (
            <Card className="animate-seal p-8">
              <h2 className="text-2xl">Diagnostic terminé</h2>
              <ButtonLink to="/onboarding/diagnostic/resultat" variant="safran" className="mt-6">
                Voir ma feuille de route
              </ButtonLink>
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <Card className="p-5">
            <CompletenessRail value={state?.profile_completeness} />
          </Card>
          {state?.profile && (
            <Card className="p-5">
              <h2 className="text-lg">Votre diagnostic</h2>
              <KeyValueList data={state.profile as Record<string, unknown>} className="mt-3" />
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
