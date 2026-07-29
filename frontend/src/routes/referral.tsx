import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { isAuthed } from "@/lib/auth";
import {
  generateReferralEmails,
  fetchReferralHistory,
  type ReferralEmail,
  type ReferralHistoryEntry,
} from "@/lib/api";

export const Route = createFileRoute("/referral")({
  head: () => ({
    meta: [
      { title: "Expert-Comptable — LedgerMind" },
      { name: "description", content: "Trouvez un expert-comptable et générez des emails de prise de contact." },
    ],
  }),
  component: ReferralPage,
});

function ReferralPage() {
  const [ville, setVille] = useState("");
  const [demande, setDemande] = useState(
    "Je suis auto-entrepreneur et je cherche un expert-comptable pour m'accompagner dans ma déclaration fiscale et mes obligations comptables.",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<ReferralEmail[]>([]);
  const [cabinetsCount, setCabinetsCount] = useState(0);
  const [history, setHistory] = useState<ReferralHistoryEntry[]>([]);
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthed()) return;
    fetchReferralHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!ville.trim() || !demande.trim()) return;
    setLoading(true);
    setError(null);
    setEmails([]);
    setCabinetsCount(0);
    try {
      const res = await generateReferralEmails(ville.trim(), demande.trim());
      if (res.status === "echec") {
        setError(res.error || "Aucun cabinet trouvé.");
      } else {
        setEmails(res.emails);
        setCabinetsCount(res.cabinets_count);
        fetchReferralHistory().then(setHistory).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Expert-Comptable"
        title={
          <>
            Trouvez un comptable, <span className="italic font-normal">contactez-le.</span>
          </>
        }
        description="Indiquez votre ville et votre besoin. L'agent referral cherche des cabinets proches et rédige un email personnalisé pour chacun."
      />

      <div className="grid lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleGenerate}
            className="bg-white border border-border rounded-2xl p-8 space-y-5"
          >
            <div>
              <label className="text-xs uppercase tracking-widest text-ink/50 font-semibold">
                Ville
              </label>
              <input
                type="text"
                value={ville}
                onChange={(e) => setVille(e.target.value)}
                placeholder="ex. Lyon, Marseille, Bordeaux…"
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border text-lg focus:outline-none focus:border-ink transition-colors"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-ink/50 font-semibold">
                Votre demande
              </label>
              <textarea
                rows={3}
                value={demande}
                onChange={(e) => setDemande(e.target.value)}
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border text-base focus:outline-none focus:border-ink transition-colors resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !ville.trim()}
              className="px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Recherche en cours…" : "Trouver & générer"}
            </button>
          </form>

          {error && (
            <div className="bg-coral/10 border border-coral/30 rounded-2xl p-6 text-sm text-coral font-medium">
              {error}
            </div>
          )}

          {loading && (
            <div className="bg-white border border-border rounded-2xl p-10 text-center space-y-3">
              <div className="inline-block size-8 border-[3px] border-ink/20 border-t-teal-dark rounded-full animate-spin" />
              <p className="text-ink/50 text-sm">
                Recherche de cabinets et génération des emails… Cela peut prendre 30 à 60 secondes.
              </p>
            </div>
          )}

          {!loading && emails.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {cabinetsCount} cabinet{cabinetsCount > 1 ? "s" : ""} trouvé
                  {cabinetsCount > 1 ? "s" : ""}
                </h2>
                <span className="text-[10px] font-mono uppercase tracking-widest text-teal-dark">
                  {emails.length} email{emails.length > 1 ? "s" : ""} généré
                  {emails.length > 1 ? "s" : ""}
                </span>
              </div>

              {emails.map((em, i) => (
                <div
                  key={i}
                  className="bg-white border border-border rounded-2xl overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedEmail(expandedEmail === i ? null : i)}
                    className="w-full p-6 flex items-center justify-between gap-4 text-left hover:bg-background/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{em.destinataire}</p>
                      <p className="text-sm text-ink/50 truncate">
                        {em.email ?? "Email non trouvé"} ·{" "}
                        <span
                          className={
                            em.statut === "ok"
                              ? "text-teal-dark"
                              : em.statut === "email_introuvable"
                                ? "text-amber-600"
                                : "text-coral"
                          }
                        >
                          {em.statut === "ok"
                            ? "Prêt à envoyer"
                            : em.statut === "email_introuvable"
                              ? "Email manquant"
                              : "Erreur"}
                        </span>
                      </p>
                    </div>
                    <svg
                      className={`size-5 text-ink/30 shrink-0 transition-transform ${expandedEmail === i ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expandedEmail === i && (
                    <div className="border-t border-border p-6 space-y-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-1">
                          Objet
                        </p>
                        <p className="text-sm font-medium">{em.objet}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                          Corps
                        </p>
                        <pre className="whitespace-pre-wrap text-sm text-ink/80 bg-background rounded-xl p-4 font-sans leading-relaxed">
                          {em.corps}
                        </pre>
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(em.corps, i)}
                          className="px-5 py-2.5 bg-ink text-background rounded-lg text-sm font-medium hover:bg-teal-dark transition-colors"
                        >
                          {copiedIdx === i ? "Copié !" : "Copier le texte"}
                        </button>
                        {em.email && (
                          <a
                            href={`mailto:${em.email}?subject=${encodeURIComponent(em.objet)}&body=${encodeURIComponent(em.corps)}`}
                            className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:border-ink transition-colors"
                          >
                            Ouvrir dans le client mail
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
            Historique des recherches
          </h3>
          {history.length === 0 ? (
            <div className="bg-white border border-border rounded-2xl p-6 text-center text-ink/40 text-sm">
              Aucune recherche effectuée.
            </div>
          ) : (
            <div className="space-y-3">
              {history
                .slice()
                .reverse()
                .map((h, i) => (
                  <div
                    key={i}
                    className="bg-white border border-border rounded-2xl p-5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{h.ville}</span>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-widest ${
                          h.status === "termine" ? "text-teal-dark" : "text-coral"
                        }`}
                      >
                        {h.status === "termine"
                          ? `${h.cabinets_count} cabinet${h.cabinets_count > 1 ? "s" : ""}`
                          : "Échec"}
                      </span>
                    </div>
                    <p className="text-xs text-ink/50 line-clamp-2">{h.demande}</p>
                    <p className="text-[10px] text-ink/30 font-mono">
                      {new Date(h.created_at).toLocaleString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
