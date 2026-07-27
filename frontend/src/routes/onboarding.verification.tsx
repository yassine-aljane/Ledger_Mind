import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogoutBubble } from "@/components/lm/AppShell";
import {
  ocrExtractSiret,
  startOrchestrator,
  orchestratorTurn,
  getStoredSessionId,
  type OrchestratorTurnResponse,
  type UserProfile,
} from "@/lib/api-mock";

export const Route = createFileRoute("/onboarding/verification")({
  head: () => ({
    meta: [
      { title: "Vérification SIRET — LedgerMind" },
      { name: "description", content: "Vérifions votre numéro SIRET en 30 secondes." },
      { property: "og:title", content: "Vérification SIRET — LedgerMind" },
      { property: "og:description", content: "Vérifions votre numéro SIRET en 30 secondes." },
    ],
  }),
  component: VerificationPage,
});

type Tab = "manual" | "upload";

function VerificationPage() {
  const [tab, setTab] = useState<Tab>("manual");
  const [siret, setSiret] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [orchestratorResult, setOrchestratorResult] = useState<OrchestratorTurnResponse | null>(null);
  const [prefetchedTurn, setPrefetchedTurn] = useState<OrchestratorTurnResponse | null>(null);
  const navigate = useNavigate();

  const digits = siret.replace(/\D/g, "");
  const digitCount = digits.length;
  const isValid = digitCount === 14;
  const showError = touched && !isValid;

  const profile: UserProfile | null = orchestratorResult?.profile ?? null;

  const runVerify = async (value: string) => {
    setLoading(true);
    setPrefetchedTurn(null);
    try {
      const r = await startOrchestrator(value);
      setOrchestratorResult(r);
      // Prefetch first profile question while the user reads the verification card
      if (r.profile.verification_status === "verified") {
        orchestratorTurn(r.session_id, undefined)
          .then(setPrefetchedTurn)
          .catch((err) => console.error("Prefetch first question failed:", err));
      }
    } catch (error) {
      console.error(error);
      setOrchestratorResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    const sessionId = getStoredSessionId() ?? orchestratorResult?.session_id;
    if (!sessionId) return;

    if (prefetchedTurn?.ui_action === "ask_question") {
      navigate({
        to: "/onboarding/profil",
        state: {
          initialQuestion: prefetchedTurn.message ?? undefined,
          initialQuickReplies: prefetchedTurn.quick_replies,
        } as Record<string, unknown>,
      });
      return;
    }

    setLoading(true);
    try {
      const turn = await orchestratorTurn(sessionId, undefined);
      navigate({
        to: "/onboarding/profil",
        state: {
          initialQuestion: turn.message ?? undefined,
          initialQuickReplies: turn.quick_replies,
        } as Record<string, unknown>,
      });
    } catch (error) {
      console.error(error);
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
      const msg = error instanceof Error ? error.message : "Erreur lors de l'extraction.";
      setOcrError(msg);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

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
          Vérifions votre <span className="italic font-normal">SIRET</span>.
        </h1>
        <p className="mt-4 text-ink/60 text-lg text-pretty max-w-xl">
          Saisissez-le directement, ou déposez un justificatif — on l'extrait pour vous.
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
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold uppercase tracking-widest text-ink/50">
                    Numéro SIRET
                  </label>
                  <span
                    className="font-mono text-xs transition-colors"
                    style={{
                      color: isValid
                        ? "var(--teal-dark)"
                        : showError
                        ? "var(--coral)"
                        : "color-mix(in oklab, var(--ink) 35%, transparent)",
                    }}
                  >
                    {digitCount}/14
                  </span>
                </div>
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
                  style={{
                    borderBottomColor: isValid
                      ? "var(--teal-dark)"
                      : showError
                      ? "var(--coral)"
                      : "var(--border)",
                  }}
                  className="w-full px-0 py-3 bg-transparent border-b-2 font-mono text-2xl focus:outline-none transition-colors placeholder:text-ink/20"
                />
                <div className="mt-2 min-h-[18px]">
                  {showError ? (
                    <p
                      className="text-xs font-medium flex items-center gap-1.5 animate-fade-in"
                      style={{ color: "var(--coral)" }}
                    >
                      <span>⚠</span>
                      {digitCount === 0
                        ? "Veuillez saisir votre numéro SIRET (14 chiffres)."
                        : digitCount < 14
                        ? `Il manque ${14 - digitCount} chiffre${14 - digitCount > 1 ? "s" : ""}.`
                        : `Trop de chiffres — le SIRET fait exactement 14 chiffres.`}
                    </p>
                  ) : isValid ? (
                    <p
                      className="text-xs font-medium flex items-center gap-1.5 animate-fade-in"
                      style={{ color: "var(--teal-dark)" }}
                    >
                      <span>✓</span> Format valide — prêt à vérifier.
                    </p>
                  ) : (
                    <p className="text-xs text-ink/40">14 chiffres, avec ou sans espaces.</p>
                  )}
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !isValid}
                className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Vérification en cours…" : "Vérifier mon SIRET"}
              </button>
            </form>
          )}

          {tab === "upload" && (
            <div className="space-y-4">
              <label
                className={`block bg-white border-2 border-dashed transition-colors rounded-2xl p-16 text-center cursor-pointer ${
                  loading
                    ? "border-teal-dark/40 opacity-70"
                    : ocrError
                    ? "border-coral/50 hover:border-coral"
                    : "border-border hover:border-teal-dark"
                }`}
              >
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
                {loading ? (
                  <>
                    <div className="mx-auto size-14 rounded-full bg-teal-dark/10 grid place-items-center mb-6 animate-pulse">
                      <span className="text-2xl text-teal-dark">⟳</span>
                    </div>
                    <p className="font-semibold text-ink">Extraction en cours…</p>
                  </>
                ) : ocrError ? (
                  <>
                    <p className="font-semibold" style={{ color: "var(--coral)" }}>Extraction échouée</p>
                    <p className="text-sm mt-2" style={{ color: "var(--coral)", opacity: 0.8 }}>{ocrError}</p>
                  </>
                ) : (
                  <>
                    <div className="mx-auto size-14 rounded-full bg-teal-dark/10 grid place-items-center mb-6">
                      <span className="text-2xl text-teal-dark">↑</span>
                    </div>
                    <p className="font-semibold text-ink">Déposez votre justificatif</p>
                    <p className="text-sm text-ink/50 mt-2">PDF ou image · Max 20 Mo</p>
                  </>
                )}
              </label>
            </div>
          )}
        </>
      )}

      {orchestratorResult && profile && (
        <div className="bg-white border border-border rounded-2xl p-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="size-8 rounded-full bg-teal-light grid place-items-center text-background text-sm">
              {profile.verification_status === "verified" ? "✓" : "!"}
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-teal-dark font-semibold">
                {profile.verification_status === "verified" ? "SIRET vérifié" : "SIRET non vérifié"}
              </p>
              <p className="font-mono text-sm text-ink/60">{profile.siret}</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Dénomination</dt>
              <dd className="mt-1 font-semibold">{profile.denomination ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Forme juridique</dt>
              <dd className="mt-1 font-semibold">{profile.legal_form ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Code APE</dt>
              <dd className="mt-1 font-semibold">{profile.ape_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Statut administratif</dt>
              <dd className="mt-1 font-semibold">{profile.administrative_status ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-widest text-ink/40">Activité déclarée</dt>
              <dd className="mt-1 font-semibold">{profile.activity_declared ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-widest text-ink/40">Explication</dt>
              <dd className="mt-1 text-sm text-ink/70">{orchestratorResult.message}</dd>
            </div>
          </dl>

          {profile.verification_status === "verified" ? (
            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
            >
              {loading ? "Chargement…" : "Continuer vers mon profil"}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 text-ink">
                <p className="font-semibold">Ce SIRET n'a pas été vérifié.</p>
                <p className="mt-2 text-sm text-ink/70">
                  Vérifiez votre numéro ou contactez l'administration.
                </p>
              </div>
              <button
                onClick={() => setOrchestratorResult(null)}
                className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
              >
                Réessayer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
