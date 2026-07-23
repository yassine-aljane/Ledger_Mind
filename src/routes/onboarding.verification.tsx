import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ocrExtractSiret, verifySiret, type SiretVerification } from "@/lib/api-mock";

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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SiretVerification | null>(null);
  const navigate = useNavigate();

  const runVerify = async (value: string) => {
    setLoading(true);
    const r = await verifySiret(value);
    setResult(r);
    setLoading(false);
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    const extracted = await ocrExtractSiret(file);
    setSiret(extracted);
    const r = await verifySiret(extracted);
    setResult(r);
    setLoading(false);
  };

  return (
    <div className="min-h-screen px-6 py-16 max-w-3xl mx-auto animate-slide-up">
      <Link to="/" className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-ink">
        ← Retour
      </Link>

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

      {!result && (
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
                if (siret.length >= 9) runVerify(siret);
              }}
              className="bg-white border border-border rounded-2xl p-8 space-y-6"
            >
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-ink/50">
                  Numéro SIRET
                </label>
                <input
                  value={siret}
                  onChange={(e) => setSiret(e.target.value)}
                  placeholder="832 174 902 00019"
                  className="w-full mt-3 px-0 py-3 bg-transparent border-b border-border font-mono text-2xl focus:outline-none focus:border-ink transition-colors placeholder:text-ink/20"
                />
                <p className="mt-2 text-xs text-ink/40">14 chiffres, avec ou sans espaces.</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40"
              >
                {loading ? "Vérification en cours…" : "Vérifier mon SIRET"}
              </button>
            </form>
          )}

          {tab === "upload" && (
            <label className="block bg-white border border-dashed border-border hover:border-teal-dark transition-colors rounded-2xl p-16 text-center cursor-pointer">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <div className="mx-auto size-14 rounded-full bg-teal-dark/10 grid place-items-center mb-6">
                <span className="text-2xl text-teal-dark">↑</span>
              </div>
              <p className="font-semibold text-ink">
                {loading ? "Extraction en cours…" : "Déposez votre justificatif"}
              </p>
              <p className="text-sm text-ink/50 mt-2">
                Avis SIRENE, extrait Kbis, justificatif auto-entrepreneur…
              </p>
            </label>
          )}
        </>
      )}

      {result && (
        <div className="bg-white border border-border rounded-2xl p-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="size-8 rounded-full bg-teal-light grid place-items-center text-background text-sm">
              ✓
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-teal-dark font-semibold">
                SIRET vérifié
              </p>
              <p className="font-mono text-sm text-ink/60">{result.siret}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Dénomination</dt>
              <dd className="mt-1 font-semibold">{result.denomination}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink/40">Régime</dt>
              <dd className="mt-1 font-semibold">{result.regime}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-widest text-ink/40">Activité</dt>
              <dd className="mt-1 font-semibold">{result.activite}</dd>
            </div>
          </dl>
          <button
            onClick={() => navigate({ to: "/onboarding/profil" })}
            className="w-full px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors"
          >
            Continuer vers mon profil
          </button>
        </div>
      )}
    </div>
  );
}
