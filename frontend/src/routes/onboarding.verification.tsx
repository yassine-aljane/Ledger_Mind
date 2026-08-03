import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, ScanLine, Upload } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { InfoTooltip, type InfoContent } from "@/components/lm/InfoTooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  detailAsTurn,
  fetchSessionDetail,
  ocrExtractSiret,
  startOrchestrator,
  orchestratorTurn,
  uploadRegistryDocument,
  uploadSireneAvis,
  getStoredSessionId,
  type OrchestratorTurnResponse,
  type UserProfile,
} from "@/lib/api";
import { repriseEnCours, routeDeReprise } from "@/lib/reprise";

export const Route = createFileRoute("/onboarding/verification")({
  head: () => ({
    meta: [
      { title: "Vérification SIREN — LedgerMind" },
      { name: "description", content: "Vérification registre, test Kbis et archivage SIRENE." },
    ],
  }),
  component: VerificationRoute,
});

function VerificationRoute() {
  return (
    <AccessGate feature="onboarding">
      <VerificationPage />
    </AccessGate>
  );
}

// Contenu vérifié à la source (jamais improvisé) — voir les URLs officielles citées.
const AIDE_JUSTIFICATIF: InfoContent = {
  titre: "Justificatif accepté",
  items: [
    { label: "À quoi ça sert", value: "Extraire automatiquement votre SIREN/SIRET depuis un document que vous avez déjà, sans le ressaisir." },
    { label: "Documents acceptés", value: "Kbis, extrait RNE, avis de situation SIRENE, ou tout document officiel affichant clairement votre numéro." },
    { label: "Format", value: "PDF ou photo/scan lisible (image)." },
    { label: "Si ça échoue", value: "Aucun blocage : basculez sur la saisie manuelle de votre SIREN/SIRET." },
  ],
};

const AIDE_KBIS: InfoContent = {
  titre: "Extrait Kbis",
  items: [
    { label: "À quoi ça sert", value: "Preuve officielle de l'immatriculation de votre entreprise au Registre du Commerce et des Sociétés (RCS) — la « carte d'identité » de l'entreprise." },
    { label: "Qui le délivre", value: "Le greffe du tribunal de commerce (service en ligne : infogreffe.fr)." },
    { label: "Format", value: "PDF, version électronique ou papier." },
    { label: "Durée de validité", value: "Généralement exigé daté de moins de 3 mois par les tiers (banques, administrations)." },
  ],
  source: { label: "service-public.gouv.fr", url: "https://entreprendre.service-public.gouv.fr/vosdroits/F21000" },
};

const AIDE_RNE: InfoContent = {
  titre: "Extrait RNE",
  items: [
    { label: "À quoi ça sert", value: "Preuve d'immatriculation au Répertoire National des Entreprises — pour les entrepreneurs individuels et autres activités non inscrites au RCS (artisans, libéraux…)." },
    { label: "Qui le délivre", value: "L'INPI, gratuitement, via data.inpi.fr (guichet unique des formalités d'entreprise)." },
    { label: "Format", value: "PDF (attestation d'inscription téléchargeable)." },
    { label: "Durée de validité", value: "Aucune durée officielle fixée — vérifiez si le destinataire en exige une récente." },
  ],
  source: { label: "inpi.fr", url: "https://www.inpi.fr/ressources/formalites-dentreprises/registre-national-entreprises" },
};

const AIDE_AVIS_SIRENE: InfoContent = {
  titre: "Avis de situation SIRENE",
  items: [
    { label: "À quoi ça sert", value: "Document officiel qui atteste l'existence légale de votre activité et récapitule votre SIREN/SIRET." },
    { label: "Qui le délivre", value: "L'INSEE, gratuitement et instantanément, sur avis-situation-sirene.insee.fr — méfiez-vous des sites tiers qui font payer ce document gratuit." },
    { label: "Format", value: "PDF téléchargeable directement depuis le site de l'INSEE, avec votre numéro SIREN." },
    { label: "Durée de validité", value: "Aucune durée officielle fixée — un document récent reste préférable." },
  ],
  source: { label: "insee.fr", url: "https://www.insee.fr/fr/information/6675111" },
};

function formatSiren(siren: string): string {
  const d = siren.replace(/\D/g, "");
  if (d.length !== 9) return siren;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

function formatSiret(siret: string): string {
  const d = siret.replace(/\D/g, "");
  if (d.length !== 14) return siret;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
}

function verificationReady(profile: UserProfile): boolean {
  if (profile.verification_status !== "verified") return false;
  if (profile.registry_document_required && !profile.registry_document_uploaded) return false;
  if (!profile.sirene_document_uploaded) return false;
  return true;
}

/* ----------------------------------- Briques d'affichage ---------------------------------- */

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** En-tête d'étape : numéro en pastille, puis intitulé. */
function StepLabel({ step, children }: { step: number; children: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2.5">
      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">
        {step}
      </span>
      <span className="rule-label text-accent-ink">{children}</span>
    </p>
  );
}

/** Zone de dépôt de fichier, réutilisée par les trois documents demandés. */
function UploadCard({
  title,
  description,
  ctaLabel,
  busy,
  error,
  aide,
  onFile,
}: {
  title: string;
  description: ReactNode;
  ctaLabel: string;
  busy: boolean;
  error?: string | null;
  aide?: InfoContent;
  onFile: (file: File) => void;
}) {
  return (
    <Card className="relative p-6">
      {/* L'icône d'aide reste HORS du <label> : un clic dessus ne doit jamais déclencher le
          sélecteur de fichier, qui occupe toute la zone pointillée. */}
      {aide && (
        <div className="absolute right-4 top-4 z-10">
          <InfoTooltip content={aide} label={title} />
        </div>
      )}
      <h3 className="text-base font-medium">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
      <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border p-6 text-center transition-all duration-200 hover:border-accent hover:bg-accent/5">
        <input
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {busy ? "Analyse en cours…" : ctaLabel}
        </span>
      </label>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Card>
  );
}

function VerificationPage() {
  const [siret, setSiret] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  // Reprise d'une vérification interrompue : tant qu'on n'a pas interrogé le serveur, on ne sait
  // pas s'il faut afficher le formulaire vide ou l'étape en cours. Montrer le formulaire d'abord
  // ferait clignoter un écran de saisie devant quelqu'un qui a déjà tout renseigné.
  const [booting, setBooting] = useState(true);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [registryUploadError, setRegistryUploadError] = useState<string | null>(null);
  const [sireneUploadError, setSireneUploadError] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [orchestratorResult, setOrchestratorResult] = useState<OrchestratorTurnResponse | null>(null);
  const [activeTurn, setActiveTurn] = useState<OrchestratorTurnResponse | null>(null);
  const navigate = useNavigate();

  const digits = siret.replace(/\D/g, "");
  const digitCount = digits.length;
  const isValid = digitCount === 9 || digitCount === 14;
  const showError = touched && !isValid;

  const profile: UserProfile | null = activeTurn?.profile ?? orchestratorResult?.profile ?? null;
  const sessionId = (() => {
    try {
      return getStoredSessionId() ?? orchestratorResult?.session_id ?? activeTurn?.session_id;
    } catch {
      return orchestratorResult?.session_id ?? activeTurn?.session_id ?? null;
    }
  })();

  /**
   * Au montage, on reprend là où l'utilisateur s'était arrêté.
   *
   * La session d'intake est déjà mémorisée localement et vit côté serveur : il suffit de
   * redemander son détail. Si elle a dépassé la vérification, on saute directement aux questions
   * de profil plutôt que de réafficher une étape déjà franchie. Une session devenue invalide
   * (expirée, supprimée) est simplement ignorée — on retombe sur le formulaire vierge.
   */
  useEffect(() => {
    let annule = false;

    void (async () => {
      try {
        const reprise = await repriseEnCours("intake");
        if (annule || !reprise) return;

        const { detail } = reprise;
        const cible = routeDeReprise(detail);
        // Une phase déjà au-delà de la vérification appartient à un autre écran :
        // on y renvoie plutôt que d'afficher une étape franchie.
        if (cible && cible !== "/onboarding/verification") {
          navigate({ to: cible, replace: true });
          return;
        }
        if (cible) setOrchestratorResult(detailAsTurn(detail));
      } finally {
        if (!annule) setBooting(false);
      }
    })();

    return () => {
      annule = true;
    };
  }, [navigate]);

  const runVerify = async (value: string) => {
    setLoading(true);
    setActiveTurn(null);
    try {
      const r = await startOrchestrator(value);
      setOrchestratorResult(r);
    } catch (error) {
      console.error(error);
      setOrchestratorResult(null);
    } finally {
      setLoading(false);
    }
  };

  const advanceVerification = async (answer?: string) => {
    if (!sessionId) return;
    setLoading(true);
    setTurnError(null);
    try {
      const turn = await orchestratorTurn(sessionId, answer);
      setActiveTurn(turn);
      setOrchestratorResult((prev) => (prev ? { ...prev, profile: turn.profile } : prev));

      if (turn.phase === "profile_questions" && turn.ui_action === "ask_question") {
        navigate({
          to: "/onboarding/profil",
          state: {
            initialQuestion: turn.message ?? undefined,
            initialQuickReplies: turn.quick_replies,
          } as Record<string, unknown>,
        });
      }
    } catch (error) {
      console.error(error);
      setTurnError(error instanceof Error ? error.message : "Erreur lors de l'étape de vérification.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegistryUpload = async (file: File) => {
    if (!sessionId) return;
    setLoading(true);
    setRegistryUploadError(null);
    try {
      await uploadRegistryDocument(sessionId, file);
      await advanceVerification();
    } catch (error) {
      setRegistryUploadError(error instanceof Error ? error.message : "Erreur d'upload.");
    } finally {
      setLoading(false);
    }
  };

  const handleSireneUpload = async (file: File) => {
    if (!sessionId) return;
    setLoading(true);
    setSireneUploadError(null);
    try {
      await uploadSireneAvis(sessionId, file);
      await advanceVerification();
    } catch (error) {
      setSireneUploadError(error instanceof Error ? error.message : "Erreur d'upload.");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    setOcrError(null);
    try {
      const extracted = await ocrExtractSiret(file);
      setSiret(extracted);
      setTouched(true);
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : "Erreur lors de l'extraction.");
    } finally {
      setLoading(false);
    }
  };

  const showRegistryDocStep =
    profile?.verification_status === "verified" &&
    profile.registry_document_required &&
    !profile.registry_document_uploaded;

  const showSireneUploadStep =
    profile?.verification_status === "verified" &&
    !showRegistryDocStep &&
    !profile.sirene_document_uploaded;

  const showContinueToProfil = profile && verificationReady(profile);
  const hasResult = Boolean(orchestratorResult && profile);

  const identite: { label: string; valeur: string; mono?: boolean }[] = profile
    ? [
        { label: "SIREN", valeur: profile.siren ? formatSiren(profile.siren) : "—", mono: true },
        {
          label: "SIRET",
          valeur: profile.siret ? formatSiret(profile.siret) : profile.siren ? "(siège)" : "—",
          mono: true,
        },
        { label: "Dénomination", valeur: profile.denomination ?? "—" },
        { label: "Forme juridique", valeur: profile.legal_form ?? "—" },
        { label: "Code NAF (statistique)", valeur: profile.ape_code ?? "—" },
        { label: "Micro-éligible", valeur: profile.micro_eligible ? "Oui (EI)" : "—" },
      ]
    : [];

  if (booting) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
          <Loader2 className="size-5 animate-spin text-primary" />
          <p className="rule-label text-muted-foreground">Reprise de votre vérification…</p>
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
            <Card className="animate-rise p-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setTouched(true);
                  if (isValid) runVerify(digits);
                }}
                className="space-y-5"
              >
                <div>
                  <label htmlFor="siret" className="rule-label text-muted-foreground">
                    Numéro SIREN / SIRET
                  </label>
                  <input
                    id="siret"
                    value={siret}
                    onChange={(e) => {
                      setSiret(e.target.value);
                      if (!touched && e.target.value.replace(/\D/g, "").length > 0) setTouched(true);
                    }}
                    onBlur={() => setTouched(true)}
                    placeholder="832 174 902 00019"
                    maxLength={19}
                    inputMode="numeric"
                    className="num mt-3 w-full border-b-2 border-border bg-transparent py-3 text-2xl tracking-wider transition-colors duration-200 focus:border-ink focus:outline-none"
                  />
                  <p
                    className={cn(
                      "mt-2 text-xs",
                      showError ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {showError
                      ? "SIREN (9) ou SIRET (14 chiffres) requis."
                      : "9 chiffres (SIREN) ou 14 chiffres (SIRET), sans espaces."}
                  </p>
                </div>
                <Button type="submit" variant="accent" disabled={loading || !isValid}>
                  {loading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  {loading ? "Vérification…" : "Lancer la vérification"}
                </Button>
              </form>
            </Card>
          )}

          {hasResult && profile && (
            <>
              <Card className="animate-rise p-6">
                <StepLabel step={1}>Identité registre</StepLabel>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {identite.map((champ) => (
                    <div key={champ.label}>
                      <dt className="rule-label text-muted-foreground">{champ.label}</dt>
                      <dd className={cn("mt-1 font-medium", champ.mono && "num")}>{champ.valeur}</dd>
                    </div>
                  ))}
                  {profile.registry_tax_base && !profile.registry_document_required && (
                    <div className="sm:col-span-2">
                      <dt className="rule-label text-muted-foreground">Base fiscale registre</dt>
                      <dd className="mt-1 font-medium text-success-ink">
                        {profile.registry_tax_base}
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {orchestratorResult?.message}
                </p>
              </Card>

              {profile.verification_status === "verified" && (
                <Card className="animate-rise p-6">
                  <StepLabel step={2}>Vérification RCS / RNE</StepLabel>
                  {profile.registry_document_uploaded ? (
                    <p className="text-sm">
                      {profile.registry_document_type === "kbis"
                        ? "✓ Kbis détecté — inscription RCS confirmée → BIC"
                        : "✓ Extrait RNE détecté — inscription RNE seule → BNC"}
                    </p>
                  ) : profile.registry_document_required ? (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                        Déposez votre Kbis (greffe / RCS)
                        <InfoTooltip content={AIDE_KBIS} label="extrait Kbis" />{" "}
                        ou votre extrait RNE (INPI)
                        <InfoTooltip content={AIDE_RNE} label="extrait RNE" />. Nous vérifions
                        automatiquement le type de document et le SIREN.
                      </p>
                      <label className="block cursor-pointer rounded-xl border border-dashed border-border p-6 text-center transition-all duration-200 hover:border-accent hover:bg-accent/5">
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="sr-only"
                          disabled={loading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleRegistryUpload(f);
                          }}
                        />
                        <span className="inline-flex items-center gap-2 text-sm font-medium">
                          {loading ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Upload className="size-4" />
                          )}
                          {loading ? "Analyse…" : "Déposer Kbis ou extrait RNE (PDF)"}
                        </span>
                      </label>
                      {registryUploadError && (
                        <p className="mt-2 text-xs text-destructive">{registryUploadError}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Société commerciale détectée — inscription RCS confirmée → BIC (pas de
                      document requis).
                    </p>
                  )}
                </Card>
              )}

              {profile.verification_status === "verified" && !showRegistryDocStep && (
                <Card className="animate-rise p-6">
                  <StepLabel step={3}>
                    Avis de situation SIRENE
                    <InfoTooltip content={AIDE_AVIS_SIRENE} label="avis de situation SIRENE" />
                  </StepLabel>
                  {profile.sirene_document_uploaded ? (
                    <div className="space-y-1 text-sm">
                      <p>✓ Document archivé</p>
                      {profile.sirene_document_activity_label && (
                        <p className="text-muted-foreground">
                          Activité : {profile.sirene_document_activity_label}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                        Téléchargez votre avis sur{" "}
                        <a
                          href="https://avis-situation-sirene.insee.fr/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline underline-offset-2"
                        >
                          avis-situation-sirene.insee.fr
                        </a>{" "}
                        puis déposez-le ici.
                      </p>
                      <label className="block cursor-pointer rounded-xl border border-dashed border-border p-6 text-center transition-all duration-200 hover:border-accent hover:bg-accent/5">
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="sr-only"
                          disabled={loading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleSireneUpload(f);
                          }}
                        />
                        <span className="inline-flex items-center gap-2 text-sm font-medium">
                          {loading ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Upload className="size-4" />
                          )}
                          {loading ? "Archivage…" : "Déposer l'avis SIRENE (PDF)"}
                        </span>
                      </label>
                      {sireneUploadError && (
                        <p className="mt-2 text-xs text-destructive">{sireneUploadError}</p>
                      )}
                      {turnError && <p className="mt-2 text-xs text-destructive">{turnError}</p>}
                    </>
                  )}
                </Card>
              )}

              {profile.verification_status === "verified" &&
                !showRegistryDocStep &&
                !showSireneUploadStep && (
                  <Button
                    size="lg"
                    variant="accent"
                    className="w-full"
                    onClick={() => advanceVerification()}
                    disabled={loading || !showContinueToProfil}
                  >
                    {loading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    {loading ? "Chargement…" : "Continuer vers mon profil"}
                  </Button>
                )}

              {profile.verification_status !== "verified" && (
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full"
                  onClick={() => setOrchestratorResult(null)}
                >
                  Réessayer
                </Button>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          {!hasResult && (
            <UploadCard
              title="Lire mon SIRET automatiquement"
              description="Photo ou PDF de votre avis de situation : l'OCR remplit le champ pour vous."
              ctaLabel="Analyser un document"
              busy={loading}
              error={ocrError}
              aide={AIDE_JUSTIFICATIF}
              onFile={handleFile}
            />
          )}
          <Card className="p-5">
            <ScanLine className="size-5 text-accent" />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Chaque étape affiche une confirmation une fois validée. En cas d&apos;échec, le
              résultat et un bouton « Réessayer » s&apos;affichent sous le formulaire.
            </p>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
