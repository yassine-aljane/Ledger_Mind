import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
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
  component: VerificationPage,
});

type Tab = "manual" | "upload";

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
  const sessionId = getStoredSessionId() ?? orchestratorResult?.session_id ?? activeTurn?.session_id;

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
        <Link to="/onboarding" className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink">
          ← Retour
        </Link>
        <LogoutBubble />
      </div>

      <div className="mt-8 mb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark mb-4">
          Étape 02 · Vérification
        </p>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance">
          Vérifions votre <span className="italic font-normal">SIREN / SIRET</span>.
        </h1>
        <p className="mt-4 text-ink/60 text-lg text-pretty max-w-xl">
          Identité registre, vérification RCS/RNE et archivage de votre avis SIRENE.
        </p>
      </div>

      {!orchestratorResult && (
        <>
          <div className="flex gap-1 p-1 bg-white border border-border rounded-full w-fit mb-8">
            <button
              onClick={() => setTab("manual")}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                tab === "manual" ? "bg-ink text-background" : "text-ink/60 hover:text-ink"
              }`}
            >
              Saisie manuelle
            </button>
            <button
              onClick={() => setTab("upload")}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                tab === "upload" ? "bg-ink text-background" : "text-ink/60 hover:text-ink"
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
              className="bg-white border border-border rounded-2xl p-8 space-y-6"
            >
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-ink/50">
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
                  className="w-full mt-3 px-0 py-3 bg-transparent border-b-2 border-border font-mono text-2xl focus:outline-none focus:border-teal-dark"
                />
                {showError && (
                  <p className="text-xs text-coral mt-2">SIREN (9) ou SIRET (14 chiffres) requis.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !isValid}
                className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
              >
                {loading ? "Vérification…" : "Étape 1 — Vérifier mon numéro"}
              </button>
            </form>
          )}

          {tab === "upload" && (
            <label className="block bg-white border-2 border-dashed border-border hover:border-teal-dark rounded-2xl p-16 text-center cursor-pointer">
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
              {ocrError && <p className="text-sm text-coral mt-2">{ocrError}</p>}
            </label>
          )}
        </>
      )}

      {orchestratorResult && profile && (
        <div className="space-y-6">
          <section className="bg-white border border-border rounded-2xl p-8">
            <p className="font-mono text-[11px] uppercase tracking-widest text-teal-dark mb-4">
              Étape 1 · Identité registre
            </p>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs uppercase text-ink/40">SIREN</dt>
                <dd className="font-semibold font-mono">
                  {profile.siren ? formatSiren(profile.siren) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink/40">SIRET</dt>
                <dd className="font-semibold font-mono">
                  {profile.siret ? formatSiret(profile.siret) : profile.siren ? "(siège)" : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink/40">Dénomination</dt>
                <dd className="font-semibold">{profile.denomination ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink/40">Forme juridique</dt>
                <dd className="font-semibold">{profile.legal_form ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink/40">Code NAF (statistique)</dt>
                <dd className="font-semibold">{profile.ape_code ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink/40">Micro-éligible</dt>
                <dd className="font-semibold">{profile.micro_eligible ? "Oui (EI)" : "—"}</dd>
              </div>
              {profile.registry_tax_base && !profile.registry_document_required && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase text-ink/40">Base fiscale registre</dt>
                  <dd className="font-semibold text-teal-dark">{profile.registry_tax_base}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-sm text-ink/60">{orchestratorResult.message}</p>
          </section>

          {profile.verification_status === "verified" && (
            <section className="bg-white border border-border rounded-2xl p-8">
              <p className="font-mono text-[11px] uppercase tracking-widest text-teal-dark mb-4">
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
                  <p className="text-sm text-ink/70 mb-4">
                    Déposez votre Kbis (greffe / RCS) ou votre extrait RNE (INPI). Nous vérifions
                    automatiquement le type de document et le SIREN.
                  </p>
                  <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-teal-dark">
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
                    <p className="text-xs text-coral mt-2">{registryUploadError}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink/70">
                  Société commerciale détectée — inscription RCS confirmée → BIC (pas de document
                  requis).
                </p>
              )}
            </section>
          )}

          {profile.verification_status === "verified" && !showRegistryDocStep && (
            <section className="bg-white border border-border rounded-2xl p-8">
              <p className="font-mono text-[11px] uppercase tracking-widest text-teal-dark mb-4">
                Étape 3 · Avis de situation SIRENE
              </p>
              {profile.sirene_document_uploaded ? (
                <div className="text-sm space-y-1">
                  <p>✓ Document archivé</p>
                  {profile.sirene_document_activity_label && (
                    <p className="text-ink/60">Activité : {profile.sirene_document_activity_label}</p>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm text-ink/70 mb-4">
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
                  <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-teal-dark">
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
                  {sireneUploadError && <p className="text-xs text-coral mt-2">{sireneUploadError}</p>}
                  {turnError && <p className="text-xs text-coral mt-2">{turnError}</p>}
                </>
              )}
            </section>
          )}

          {profile.verification_status === "verified" && !showRegistryDocStep && !showSireneUploadStep && (
            <button
              onClick={() => advanceVerification()}
              disabled={loading || !showContinueToProfil}
              className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
            >
              {loading ? "Chargement…" : "Continuer vers mon profil →"}
            </button>
          )}

          {profile.verification_status !== "verified" && (
            <button
              onClick={() => setOrchestratorResult(null)}
              className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold"
            >
              Réessayer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
