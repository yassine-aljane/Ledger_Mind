import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { ProfileConfirmEditor, type EditableIntakeProfile } from "@/components/profile-confirm";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Badge,
} from "@/components/ui-kit";
import {
  CompletenessRail,
  KeyValueList,
  QuestionCard,
  UploadCard,
  VerificationResult,
} from "@/components/orchestrator";
import { api, ApiError, detailAsTurn } from "@/lib/api";
import { invalidateOnboardingCache, useAuth } from "@/lib/auth";
import { clearSession, loadSession, saveSession } from "@/lib/session-store";
import type { OrchestratorResponse } from "@/lib/types";

export const Route = createFileRoute("/onboarding/profil")({
  head: () => ({
    meta: [
      { title: "Profil fiscal — LedgerMind" },
      {
        name: "description",
        content:
          "Répondez aux questions de l'agent LedgerMind pour construire votre profil fiscal et obtenir votre régime recommandé.",
      },
      { property: "og:title", content: "Profil fiscal — LedgerMind" },
      { property: "og:description", content: "Votre profil fiscal, question après question." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="onboarding"
      title="Votre profil fiscal guidé"
      pitch="Une conversation courte qui aboutit à un régime recommandé et des alertes de conformité."
      benefits={[
        "Questions adaptées à votre activité réelle",
        "Régime recommandé et alertes de conformité",
        "Actions prioritaires listées, pas de jargon inutile",
      ]}
      preview={
        <Card className="p-8">
          <p className="rule-label text-muted-foreground">Question de l'agent</p>
          <p className="mt-3 text-lg">Vos clients sont-ils situés hors de France ?</p>
        </Card>
      }
    >
      <Profil />
    </PremiumGate>
  );
}

function toEditable(profile: Record<string, unknown>): EditableIntakeProfile {
  return {
    denomination: (profile.denomination as string | null) ?? null,
    siret: (profile.siret as string | null) ?? null,
    siren: (profile.siren as string | null) ?? null,
    tax_category: (profile.tax_category as string | null) ?? null,
    recommended_regime: (profile.recommended_regime as string | null) ?? null,
    regime_plafond: (profile.regime_plafond as string | null) ?? null,
    tax_category_reason: (profile.tax_category_reason as string | null) ?? null,
    fiscal_classification_status: (profile.fiscal_classification_status as string | null) ?? null,
    fiscal_inconsistency_reason: (profile.fiscal_inconsistency_reason as string | null) ?? null,
    activity_mismatch: Boolean(profile.activity_mismatch),
    mismatches: Array.isArray(profile.mismatches)
      ? (profile.mismatches as Array<{ note?: string }>)
      : [],
    activity_types: Array.isArray(profile.activity_types) ? (profile.activity_types as string[]) : [],
    revenue_sources: Array.isArray(profile.revenue_sources)
      ? (profile.revenue_sources as string[])
      : [],
    currencies: Array.isArray(profile.currencies) ? (profile.currencies as string[]) : [],
    estimated_monthly_revenue: (profile.estimated_monthly_revenue as string | null) ?? null,
    estimated_annual_revenue: (profile.estimated_annual_revenue as string | null) ?? null,
    first_income_date: (profile.first_income_date as string | null) ?? null,
    revenue_variability:
      (profile.revenue_variability as EditableIntakeProfile["revenue_variability"]) ?? null,
    international_clients: (profile.international_clients as boolean | null) ?? null,
    invoices_already_issued: (profile.invoices_already_issued as boolean | null) ?? null,
    has_recurring_contracts: (profile.has_recurring_contracts as boolean | null) ?? null,
    in_kind_gifts: (profile.in_kind_gifts as boolean | null) ?? null,
    has_secondary_activity: (profile.has_secondary_activity as boolean | null) ?? null,
    secondary_activity_types: Array.isArray(profile.secondary_activity_types)
      ? (profile.secondary_activity_types as string[])
      : [],
    main_activity_commercial: (profile.main_activity_commercial as boolean | null) ?? null,
  };
}

function Profil() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState<OrchestratorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const sessionId = loadSession("intake");

  useEffect(() => {
    let alive = true;
    async function boot() {
      if (!sessionId) {
        setLoading(false);
        return;
      }
      try {
        const detail = await api.sessionDetail(sessionId);

        if (
          detail.phase === "verification" ||
          detail.phase === "verification_registry_document" ||
          detail.phase === "verification_document"
        ) {
          if (alive) setError("Reprenez la vérification SIRET avant les questions de profil.");
          return;
        }

        if (detail.phase === "profile_questions") {
          const live = await api.turn({ session_id: sessionId });
          if (alive) setState(live);
          return;
        }

        if (alive) setState(detailAsTurn(detail));
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : "Session introuvable.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void boot();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  async function run(fn: () => Promise<OrchestratorResponse>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setState(res);
      saveSession("intake", res.session_id);
      if (res.ui_action === "done") {
        toast.success("Questions terminées — vérifiez et ajustez votre synthèse.");
        invalidateOnboardingCache();
        void refresh();
        return;
      }
      if (res.ui_action === "requires_expert") {
        toast.success("Analyse terminée — vérifiez votre profil avant de continuer.");
        invalidateOnboardingCache();
        void refresh();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Une erreur est survenue.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function patchProfile(patch: Record<string, unknown>) {
    if (!sessionId) return;
    setPatchBusy(true);
    try {
      const detail = await api.patchIntakeProfile(sessionId, patch);
      setState(detailAsTurn(detail));
      invalidateOnboardingCache();
      toast.success("Profil mis à jour.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Modification impossible.");
    } finally {
      setPatchBusy(false);
    }
  }

  async function confirmAndGoDashboard() {
    setConfirming(true);
    try {
      invalidateOnboardingCache();
      await refresh();
      toast.success("Profil confirmé — bienvenue sur votre tableau de bord.");
      navigate({ to: "/dashboard", replace: true });
    } catch {
      toast.error("Impossible d'ouvrir le tableau de bord. Réessayez.");
    } finally {
      setConfirming(false);
    }
  }

  function restartQuestions() {
    clearSession("intake");
    navigate({ to: "/onboarding/verification", replace: true });
  }

  if (loading)
    return (
      <AppShell>
        <LoadingBlock label="Reprise de votre session…" />
      </AppShell>
    );

  if (!sessionId)
    return (
      <AppShell>
        <PageHeader eyebrow="Étape 2" title="Profil fiscal" />
        <EmptyState
          title="Aucun parcours en cours"
          description="Commencez par vérifier votre établissement : les questions suivantes s'appuient dessus."
          action={
            <ButtonLink to="/onboarding/verification" variant="safran">
              Vérifier mon SIRET
            </ButtonLink>
          }
        />
      </AppShell>
    );

  if (error?.includes("vérification SIRET")) {
    return (
      <AppShell>
        <PageHeader eyebrow="Étape 2" title="Profil fiscal" />
        <EmptyState
          title="Vérification incomplète"
          description={error}
          action={
            <ButtonLink to="/onboarding/verification" variant="safran">
              Reprendre la vérification
            </ButtonLink>
          }
        />
      </AppShell>
    );
  }

  const profile = (state?.profile as Record<string, unknown>) ?? {};
  const done = state?.ui_action === "done" || state?.phase === "done";
  const expert = state?.ui_action === "requires_expert";
  const showConfirm = done || expert;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Étape 2 · Parcours avec SIREN"
        title={showConfirm ? "Vérifiez et ajustez votre profil" : "Construisons votre profil fiscal"}
        description={
          showConfirm
            ? "Modifiez n'importe quelle réponse avant de confirmer et d'ouvrir le tableau de bord."
            : "Chaque réponse affine le régime recommandé et les obligations qui vous concernent."
        }
      />

      <div
        className={
          showConfirm
            ? "mx-auto max-w-2xl"
            : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        }
      >
        <div className="space-y-6">
          {error && <ErrorBlock message={error} />}

          {!showConfirm && state?.ui_action === "ask_question" && (
            <QuestionCard
              message={state.message}
              quickReplies={state.quick_replies}
              busy={busy}
              onAnswer={(a) => run(() => api.turn({ session_id: sessionId, user_answer: a }))}
            />
          )}

          {!showConfirm &&
            (state?.ui_action === "show_tax_result" || state?.ui_action === "show_compliance") && (
              <Card className="animate-rise p-6">
                <Badge tone="info">
                  {state.ui_action === "show_tax_result" ? "Classification fiscale" : "Conformité"}
                </Badge>
                <p className="mt-4 whitespace-pre-wrap text-sm">
                  {state.message || "Consultez la synthèse à droite, puis continuez."}
                </p>
                <Button
                  className="mt-6"
                  variant="safran"
                  disabled={busy}
                  onClick={() => run(() => api.turn({ session_id: sessionId }))}
                >
                  Continuer
                </Button>
              </Card>
            )}

          {!showConfirm && state?.ui_action === "show_verification_result" && (
            <VerificationResult
              profile={profile}
              busy={busy}
              onContinue={() => run(() => api.turn({ session_id: sessionId }))}
            />
          )}

          {!showConfirm &&
            (state?.ui_action === "upload_registry_document" ||
              state?.ui_action === "upload_sirene_document") && (
              <UploadCard
                title={
                  state.ui_action === "upload_registry_document"
                    ? "Document de registre requis"
                    : "Avis de situation SIRENE"
                }
                description={state.message ?? undefined}
                busy={busy}
                onFile={(f) =>
                  run(() =>
                    api.afterVerificationUpload(sessionId, () =>
                      state.ui_action === "upload_registry_document"
                        ? api.registryDocument(sessionId, f)
                        : api.sireneAvis(sessionId, f),
                    ),
                  )
                }
              />
            )}

          {showConfirm && (
            <ProfileConfirmEditor
              profile={toEditable(profile)}
              message={state?.message}
              expert={expert}
              busy={patchBusy}
              confirming={confirming}
              onPatch={patchProfile}
              onConfirm={() => void confirmAndGoDashboard()}
              onRestart={restartQuestions}
            />
          )}

          {!state && (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">Session chargée sans action en attente.</p>
              <Button className="mt-4" onClick={() => run(() => api.turn({ session_id: sessionId }))}>
                Continuer
              </Button>
            </Card>
          )}
        </div>

        {!showConfirm && (
          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <Card className="p-5">
              <CompletenessRail value={state?.profile_completeness} />
            </Card>
            <Card className="p-5">
              <h2 className="text-lg">Ce que nous savons</h2>
              {Object.keys(profile).length ? (
                <KeyValueList data={profile} className="mt-3" />
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Les informations apparaîtront au fil de vos réponses.
                </p>
              )}
            </Card>
            <p className="px-1 text-xs text-muted-foreground">
              Besoin d'un rappel de règle ?{" "}
              <Link to="/education" className="underline decoration-accent underline-offset-4">
                Ouvrir l'Éducation
              </Link>
            </p>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
