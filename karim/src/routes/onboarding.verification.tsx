import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ScanLine } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { Button, Card, ErrorBlock, Field, Input, SectionLabel, Spinner } from "@/components/ui-kit";
import { StepDoneCard, UploadCard, VerificationResult } from "@/components/orchestrator";
import { api, ApiError, detailAsTurn } from "@/lib/api";
import { clearSession, loadSession, saveSession } from "@/lib/session-store";
import type { OrchestratorResponse } from "@/lib/types";

export const Route = createFileRoute("/onboarding/verification")({
  head: () => ({
    meta: [
      { title: "Vérification SIRET — LedgerMind" },
      {
        name: "description",
        content:
          "Vérifiez votre établissement auprès des registres officiels et lancez votre parcours d'immatriculation guidé.",
      },
      { property: "og:title", content: "Vérification SIRET — LedgerMind" },
      { property: "og:description", content: "Contrôle officiel de votre établissement." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="onboarding"
      title="Vérification officielle"
      pitch="Votre SIRET confronté aux registres : forme juridique, code APE, éligibilité micro, écarts détectés."
      benefits={[
        "OCR de votre avis de situation pour éviter la saisie",
        "Écarts entre déclaratif et registre signalés",
        "Profil fiscal pré-rempli pour la suite du parcours",
      ]}
      preview={
        <Card className="p-8">
          <SectionLabel>Aperçu du contrôle</SectionLabel>
          <h3 className="mt-4 text-2xl">Studio Marge Nord — EI</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            APE 7410Z · Éligible micro-entreprise · 1 écart détecté sur l'adresse déclarée.
          </p>
        </Card>
      }
    >
      <Verification />
    </PremiumGate>
  );
}

function registryDoneLabel(profile: Record<string, unknown>) {
  if (profile.registry_document_type === "kbis") {
    return "Kbis détecté — inscription RCS confirmée (BIC).";
  }
  if (profile.registry_document_type === "rne_extract") {
    return "Extrait RNE détecté — inscription RNE confirmée (BNC).";
  }
  return "Document de registre enregistré et validé.";
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function Verification() {
  const [siret, setSiret] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [state, setState] = useState<OrchestratorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const navigate = useNavigate();

  const digits = digitsOnly(siret);
  const siretValid = digits.length === 9 || digits.length === 14;

  useEffect(() => {
    const sid = loadSession("intake");
    if (!sid) {
      setBooting(false);
      return;
    }
    void (async () => {
      try {
        const detail = await api.sessionDetail(sid);
        if (detail.phase === "profile_questions") {
          navigate({ to: "/onboarding/profil", replace: true });
          return;
        }
        if (
          detail.phase === "verification" ||
          detail.phase === "verification_registry_document" ||
          detail.phase === "verification_document"
        ) {
          setState(detailAsTurn(detail));
        }
      } catch {
        clearSession("intake");
      } finally {
        setBooting(false);
      }
    })();
  }, [navigate]);

  function apply(res: OrchestratorResponse, prev: OrchestratorResponse | null) {
    const profile = (res.profile ?? {}) as Record<string, unknown>;
    const verified = profile.verification_status === "verified";

    if (!prev && res.ui_action === "show_verification_result") {
      if (verified) {
        toast.success("Étape 1 validée — identité registre confirmée.");
      } else {
        toast.error(res.message || "Identité non confirmée. Vérifiez le numéro saisi.");
      }
    }
    if (prev?.ui_action === "show_verification_result" && res.ui_action === "upload_registry_document") {
      toast.success("Étape 1 terminée. Passez à l'étape 2 : document RCS / RNE.");
    }
    if (prev?.ui_action === "show_verification_result" && res.ui_action === "upload_sirene_document") {
      toast.success("Étape 1 terminée. Passez à l'étape 3 : avis SIRENE.");
    }
    if (prev?.ui_action === "upload_registry_document" && res.ui_action !== "upload_registry_document") {
      toast.success("Étape 2 validée — document de registre enregistré.");
    }
    if (prev?.ui_action === "upload_sirene_document" && res.ui_action === "ask_question") {
      toast.success("Étape 3 validée — avis SIRENE archivé. Les questions de profil commencent.");
    }

    setState(res);
    saveSession("intake", res.session_id);
    if (res.ui_action === "ask_question") {
      navigate({ to: "/onboarding/profil" });
    }
  }

  async function run<T extends OrchestratorResponse>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      apply(res, state);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Une erreur est survenue.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function ocr(file: File) {
    setBusy(true);
    try {
      const res = await api.ocrSiret(file);
      if (res.siret) {
        setSiret(res.siret);
        toast.success("SIRET détecté sur le document.");
      } else {
        toast.error("Aucun SIRET lisible sur ce document.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lecture du document impossible.");
    } finally {
      setBusy(false);
    }
  }

  function resetIdentity() {
    clearSession("intake");
    setState(null);
    setError(null);
  }

  const profile = (state?.profile ?? {}) as Record<string, unknown>;
  const verified = profile.verification_status === "verified";
  const registryRequired = Boolean(profile.registry_document_required);
  const registryDone = Boolean(profile.registry_document_uploaded);
  const sireneDone = Boolean(profile.sirene_document_uploaded);
  const hasResult = Boolean(state);

  if (booting) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Étape 1 · Parcours avec SIREN"
        title="Vérifions votre établissement"
        description="Trois étapes : identité registre, document RCS/RNE si requis, puis avis SIRENE."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {!hasResult && (
            <Card className="animate-rise space-y-5 p-6">
              <Field
                label="SIREN ou SIRET"
                htmlFor="siret"
                hint="9 chiffres (SIREN) ou 14 chiffres (SIRET), sans espaces."
                error={
                  siret && !siretValid
                    ? "Indiquez un SIREN (9 chiffres) ou un SIRET (14 chiffres)."
                    : null
                }
              >
                <Input
                  id="siret"
                  inputMode="numeric"
                  value={siret}
                  onChange={(e) => setSiret(e.target.value.replace(/[^\d\s]/g, ""))}
                  placeholder="123 456 789 00012"
                  className="font-mono tracking-wider"
                />
              </Field>
              <Field label="Nom de l'entreprise (optionnel)" htmlFor="company">
                <Input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Studio Marge Nord"
                />
              </Field>
              <Button
                variant="safran"
                disabled={!siretValid || busy}
                onClick={() =>
                  run(() =>
                    api.start({
                      siret: digits,
                      company_name: companyName.trim() || undefined,
                      branch: "intake",
                    }),
                  )
                }
              >
                {busy ? <Spinner /> : <ArrowRight />} Lancer la vérification
              </Button>
            </Card>
          )}

          {error && <ErrorBlock message={error} />}

          {hasResult && (
            <>
              {state?.ui_action === "show_verification_result" || !verified ? (
                <VerificationResult
                  profile={profile}
                  message={state?.message}
                  busy={busy}
                  onContinue={
                    verified
                      ? () => run(() => api.turn({ session_id: state!.session_id }))
                      : undefined
                  }
                  onRetry={!verified ? resetIdentity : undefined}
                />
              ) : (
                <StepDoneCard
                  step={1}
                  title="Identité registre confirmée"
                  detail={String(profile.denomination || profile.siren || "Établissement vérifié")}
                />
              )}

              {verified && (
                <>
                  {registryRequired ? (
                    registryDone ? (
                      <StepDoneCard
                        step={2}
                        title="Vérification RCS / RNE"
                        detail={registryDoneLabel(profile)}
                      />
                    ) : state?.ui_action === "upload_registry_document" ? (
                      <UploadCard
                        title="Étape 2 · Document RCS / RNE"
                        description={
                          state.message ??
                          "Déposez votre Kbis (greffe / RCS) ou votre extrait RNE (INPI). Nous vérifions le type et le SIREN."
                        }
                        busy={busy}
                        onFile={(f) =>
                          run(() =>
                            api.afterVerificationUpload(state.session_id, () =>
                              api.registryDocument(state.session_id, f),
                            ),
                          )
                        }
                      />
                    ) : null
                  ) : state?.ui_action !== "show_verification_result" ? (
                    <StepDoneCard
                      step={2}
                      title="RCS confirmé automatiquement"
                      detail={String(
                        profile.registry_tax_base ||
                          "Inscription RCS détectée — pas de document requis.",
                      )}
                    />
                  ) : null}

                  {(registryDone || !registryRequired) &&
                    state?.ui_action !== "show_verification_result" &&
                    (sireneDone ? (
                      <StepDoneCard
                        step={3}
                        title="Avis SIRENE archivé"
                        detail={String(
                          profile.sirene_document_activity_label ||
                            "Document enregistré pour votre dossier.",
                        )}
                      />
                    ) : state?.ui_action === "upload_sirene_document" ? (
                      <UploadCard
                        title="Étape 3 · Avis de situation SIRENE"
                        description={
                          state.message ??
                          "Téléchargez votre avis sur avis-situation-sirene.insee.fr puis déposez-le ici."
                        }
                        busy={busy}
                        onFile={(f) =>
                          run(() =>
                            api.afterVerificationUpload(state.session_id, () =>
                              api.sireneAvis(state.session_id, f),
                            ),
                          )
                        }
                      />
                    ) : null)}

                  {sireneDone && state?.ui_action === "ask_question" && (
                    <Card className="animate-rise p-6">
                      <p className="text-sm text-muted-foreground">
                        Les trois étapes de vérification sont terminées. Passez aux questions de
                        profil fiscal.
                      </p>
                      <Button
                        variant="safran"
                        className="mt-4"
                        onClick={() => navigate({ to: "/onboarding/profil" })}
                      >
                        Continuer vers les questions <ArrowRight />
                      </Button>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          {!hasResult && (
            <UploadCard
              title="Lire mon SIRET automatiquement"
              description="Photo ou PDF de votre avis de situation : l'OCR remplit le champ pour vous."
              busy={busy}
              ctaLabel="Analyser un document"
              onFile={ocr}
            />
          )}
          <Card className="p-5">
            <ScanLine className="size-5 text-accent" />
            <p className="mt-3 text-sm text-muted-foreground">
              Chaque étape affiche une confirmation une fois validée. En cas d'échec, le résultat et
              un bouton « Réessayer » s'affichent sous le formulaire.
            </p>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
