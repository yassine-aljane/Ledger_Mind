import { createFileRoute } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { Check, ChevronDown, Copy, Loader2, Mail, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAuthed } from "@/lib/auth";
import { cn } from "@/lib/utils";
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
  component: ReferralRoute,
});

function ReferralRoute() {
  return (
    <AccessGate feature="referral" premiumKind="referral">
      <ReferralPage />
    </AccessGate>
  );
}

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
            className="animate-rise space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft"
          >
            <div>
              <label htmlFor="referral-ville" className="rule-label text-muted-foreground">
                Ville
              </label>
              <input
                id="referral-ville"
                type="text"
                value={ville}
                onChange={(e) => setVille(e.target.value)}
                placeholder="ex. Lyon, Marseille, Bordeaux…"
                className="mt-2 w-full border-b border-border bg-transparent py-2.5 text-base transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="referral-demande" className="rule-label text-muted-foreground">
                Votre demande
              </label>
              <textarea
                id="referral-demande"
                rows={3}
                value={demande}
                onChange={(e) => setDemande(e.target.value)}
                className="mt-2 w-full resize-none border-b border-border bg-transparent py-2.5 text-sm transition-colors duration-200 focus:border-ink focus:outline-none"
              />
            </div>
            <Button type="submit" size="lg" variant="accent" disabled={loading || !ville.trim()}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" /> Recherche en cours…
                </>
              ) : (
                <>
                  <Search /> Trouver &amp; générer
                </>
              )}
            </Button>
          </form>

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/8 p-5 text-sm font-medium text-destructive"
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Recherche de cabinets et génération des emails… Cela peut prendre 30 à 60 secondes.
              </p>
            </div>
          )}

          {!loading && emails.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg">
                  {cabinetsCount} cabinet{cabinetsCount > 1 ? "s" : ""} trouvé
                  {cabinetsCount > 1 ? "s" : ""}
                </h2>
                <Badge variant="outline">
                  {emails.length} email{emails.length > 1 ? "s" : ""} généré
                  {emails.length > 1 ? "s" : ""}
                </Badge>
              </div>

              {emails.map((em, i) => (
                <div
                  key={i}
                  className="card-hover animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedEmail(expandedEmail === i ? null : i)}
                    aria-expanded={expandedEmail === i}
                    className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-secondary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{em.destinataire}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {em.email ?? "Email non trouvé"} ·{" "}
                        <span
                          className={
                            em.statut === "ok"
                              ? "text-success-ink"
                              : em.statut === "email_introuvable"
                                ? "text-amber-fiscal"
                                : "text-destructive"
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
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        expandedEmail === i && "rotate-180",
                      )}
                    />
                  </button>

                  {expandedEmail === i && (
                    <div className="animate-fade-in space-y-4 border-t border-border p-5">
                      <div>
                        <p className="rule-label mb-1.5 text-muted-foreground">Objet</p>
                        <p className="text-sm font-medium">{em.objet}</p>
                      </div>
                      <div>
                        <p className="rule-label mb-2 text-muted-foreground">Corps</p>
                        <pre className="whitespace-pre-wrap rounded-xl bg-secondary/60 p-4 font-sans text-sm leading-relaxed text-foreground">
                          {em.corps}
                        </pre>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => copyToClipboard(em.corps, i)}>
                          {copiedIdx === i ? (
                            <>
                              <Check /> Copié !
                            </>
                          ) : (
                            <>
                              <Copy /> Copier le texte
                            </>
                          )}
                        </Button>
                        {em.email && (
                          <Button asChild variant="outline">
                            <a
                              href={`mailto:${em.email}?subject=${encodeURIComponent(em.objet)}&body=${encodeURIComponent(em.corps)}`}
                            >
                              <Mail /> Ouvrir dans le client mail
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="space-y-5 lg:sticky lg:top-24 lg:col-span-5">
          <h2 className="rule-label text-accent-ink">Historique des recherches</h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
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
                    className="card-hover space-y-2 rounded-2xl border border-border bg-card p-4 shadow-soft"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{h.ville}</span>
                      <Badge variant={h.status === "termine" ? "success" : "destructive"}>
                        {h.status === "termine"
                          ? `${h.cabinets_count} cabinet${h.cabinets_count > 1 ? "s" : ""}`
                          : "Échec"}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{h.demande}</p>
                    <p className="num text-xs text-muted-foreground/70">
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
