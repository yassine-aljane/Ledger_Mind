import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import { InfoTooltip, type InfoContent } from "@/components/lm/InfoTooltip";
import {
  ocrExtractSiret,
  startOrchestrator,
  orchestratorTurn,
  uploadRegistryDocument,
  uploadSireneAvis,
  getStoredSessionId,
  type OrchestratorTurnResponse,
  type UserProfile,
} from "@/lib/api";

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

type Tab = "manual" | "upload";

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

function VerificationPage() {
  const [tab, setTab] = useState<Tab>("manual");
  const [siret, setSiret] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
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
      setTab("manual");
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

  return (
    <div className="min-h-screen px-6 py-16 max-w-3xl mx-auto animate-slide-up">
      <div className="flex items-center justify-between gap-4">
        <Link to="/onboarding" className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-ink transition-colors duration-200">
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      <div className="mt-8 mb-12">
        <p className="rule-label text-teal-dark mb-4">
          Étape 02 · Vérification
        </p>
        <h1 className="text-4xl md:text-5xl font-medium text-balance">
          Vérifions votre <span className="italic font-normal">SIREN / SIRET</span>.
        </h1>
        <p className="mt-4 text-muted-foreground text-lg text-pretty max-w-xl">
          Identité registre, vérification RCS/RNE et archivage de votre avis SIRENE.
        </p>
      </div>

      {!orchestratorResult && (
        <>
          <div className="flex gap-1 p-1 bg-card border border-border rounded-full w-fit mb-8">
            <button
              onClick={() => setTab("manual")}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 active:scale-[0.97] ${
                tab === "manual" ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-ink"
              }`}
            >
              Saisie manuelle
            </button>
            <button
              onClick={() => setTab("upload")}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 active:scale-[0.97] ${
                tab === "upload" ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-ink"
              }`}
            >
              Uploader un document
            </button>
          </div>

          {tab === "manual" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (isValid) runVerify(digits);
              }}
              className="bg-card border border-border rounded-2xl p-8 space-y-6"
            >
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Numéro SIREN / SIRET
                </label>
                <input
                  value={siret}
                  onChange={(e) => {
                    setSiret(e.target.value);
                    if (!touched && e.target.value.replace(/\D/g, "").length > 0) setTouched(true);
                  }}
                  onBlur={() => setTouched(true)}
                  placeholder="832 174 902 00019"
                  maxLength={19}
                  inputMode="numeric"
                  className="w-full mt-3 px-0 py-3 bg-transparent border-b-2 border-border font-mono text-2xl focus:outline-none focus:border-teal-dark transition-colors duration-200"
                />
                {showError && (
                  <p className="text-xs text-destructive mt-2">SIREN (9) ou SIRET (14 chiffres) requis.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !isValid}
                className="w-full px-8 py-4 bg-ink text-ink-foreground rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
              >
                {loading ? "Vérification…" : "Étape 1 — Vérifier mon numéro"}
              </button>
            </form>
          )}

          {tab === "upload" && (
            <div className="relative">
              {/* L'icône d'aide reste HORS du <label> : un clic dessus ne doit jamais déclencher
                  le sélecteur de fichier associé au champ, qui occupe toute la zone pointillée. */}
              <div className="absolute top-3 right-3 z-10">
                <InfoTooltip content={AIDE_JUSTIFICATIF} label="justificatif accepté" />
              </div>
              <label className="block bg-card border-2 border-dashed border-border hover:border-teal-dark hover:bg-teal-dark/5 transition-all duration-200 rounded-2xl p-16 text-center cursor-pointer">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  disabled={loading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <p className="font-semibold">{loading ? "Extraction…" : "Déposez votre justificatif"}</p>
                {ocrError && <p className="text-sm text-destructive mt-2">{ocrError}</p>}
              </label>
            </div>
          )}
        </>
      )}

      {orchestratorResult && profile && (
        <div className="space-y-6">
          <section className="bg-card border border-border rounded-2xl p-8">
            <p className="rule-label text-teal-dark mb-4">
              Étape 1 · Identité registre
            </p>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">SIREN</dt>
                <dd className="font-semibold font-mono">
                  {profile.siren ? formatSiren(profile.siren) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">SIRET</dt>
                <dd className="font-semibold font-mono">
                  {profile.siret ? formatSiret(profile.siret) : profile.siren ? "(siège)" : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Dénomination</dt>
                <dd className="font-semibold">{profile.denomination ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Forme juridique</dt>
                <dd className="font-semibold">{profile.legal_form ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Code NAF (statistique)</dt>
                <dd className="font-semibold">{profile.ape_code ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Micro-éligible</dt>
                <dd className="font-semibold">{profile.micro_eligible ? "Oui (EI)" : "—"}</dd>
              </div>
              {profile.registry_tax_base && !profile.registry_document_required && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase text-muted-foreground">Base fiscale registre</dt>
                  <dd className="font-semibold text-teal-dark">{profile.registry_tax_base}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">{orchestratorResult.message}</p>
          </section>

          {profile.verification_status === "verified" && (
            <section className="bg-card border border-border rounded-2xl p-8">
              <p className="rule-label text-teal-dark mb-4">
                Étape 2 · Vérification RCS / RNE
              </p>
              {profile.registry_document_uploaded ? (
                <p className="text-sm">
                  {profile.registry_document_type === "kbis"
                    ? "✓ Kbis détecté — inscription RCS confirmée → BIC"
                    : "✓ Extrait RNE détecté — inscription RNE seule → BNC"}
                </p>
              ) : profile.registry_document_required ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Déposez votre Kbis (greffe / RCS)
                    <InfoTooltip content={AIDE_KBIS} label="extrait Kbis" />{" "}
                    ou votre extrait RNE (INPI)
                    <InfoTooltip content={AIDE_RNE} label="extrait RNE" />. Nous vérifions
                    automatiquement le type de document et le SIREN.
                  </p>
                  <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-teal-dark hover:bg-teal-dark/5 transition-all duration-200">
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
                    <span className="text-sm font-semibold">
                      {loading ? "Analyse…" : "Déposer Kbis ou extrait RNE (PDF)"}
                    </span>
                  </label>
                  {registryUploadError && (
                    <p className="text-xs text-destructive mt-2">{registryUploadError}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Société commerciale détectée — inscription RCS confirmée → BIC (pas de document
                  requis).
                </p>
              )}
            </section>
          )}

          {profile.verification_status === "verified" && !showRegistryDocStep && (
            <section className="bg-card border border-border rounded-2xl p-8">
              <p className="rule-label text-teal-dark mb-4 inline-flex items-center gap-1.5">
                Étape 3 · Avis de situation SIRENE
                <InfoTooltip content={AIDE_AVIS_SIRENE} label="avis de situation SIRENE" />
              </p>
              {profile.sirene_document_uploaded ? (
                <div className="text-sm space-y-1">
                  <p>✓ Document archivé</p>
                  {profile.sirene_document_activity_label && (
                    <p className="text-muted-foreground">Activité : {profile.sirene_document_activity_label}</p>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Téléchargez votre avis sur{" "}
                    <a
                      href="https://avis-situation-sirene.insee.fr/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-teal-dark"
                    >
                      avis-situation-sirene.insee.fr
                    </a>{" "}
                    puis déposez-le ici.
                  </p>
                  <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-teal-dark hover:bg-teal-dark/5 transition-all duration-200">
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
                    <span className="text-sm font-semibold">
                      {loading ? "Archivage…" : "Déposer l'avis SIRENE (PDF)"}
                    </span>
                  </label>
                  {sireneUploadError && <p className="text-xs text-destructive mt-2">{sireneUploadError}</p>}
                  {turnError && <p className="text-xs text-destructive mt-2">{turnError}</p>}
                </>
              )}
            </section>
          )}

          {profile.verification_status === "verified" && !showRegistryDocStep && !showSireneUploadStep && (
            <button
              onClick={() => advanceVerification()}
              disabled={loading || !showContinueToProfil}
              className="w-full px-8 py-4 bg-ink text-ink-foreground rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
            >
              {loading ? "Chargement…" : "Continuer vers mon profil →"}
            </button>
          )}

          {profile.verification_status !== "verified" && (
            <button
              onClick={() => setOrchestratorResult(null)}
              className="w-full px-8 py-4 bg-ink text-ink-foreground rounded-xl font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.98]"
            >
              Réessayer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
