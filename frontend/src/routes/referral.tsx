import { createFileRoute } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { CabinetsMap, CabinetContactLines, type CabinetMapPoint } from "@/components/lm/CabinetsMap";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  MapPinned,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/lm/AppShell";
import { Button } from "@/components/ui/button";
import { isAuthed } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  generateReferralEmails,
  fetchReferralHistory,
  type ReferralCabinet,
  type ReferralEmail,
  type ReferralHistoryEntry,
} from "@/lib/api";

export const Route = createFileRoute("/referral")({
  head: () => ({
    meta: [
      { title: "Expert-comptable — LedgerMind" },
      {
        name: "description",
        content:
          "Trouvez un expert-comptable qui comprend les créateurs : sponsos, multi-plateformes, micro-entreprise.",
      },
    ],
  }),
  component: ReferralRoute,
});

const VILLES_RAPIDES = ["Paris", "Lyon", "Marseille", "Bordeaux", "Lille", "Nantes", "Toulouse"] as const;

function ReferralRoute() {
  return (
    <AccessGate feature="referral" premiumKind="referral">
      <ReferralPage />
    </AccessGate>
  );
}

function cabinetId(c: Pick<ReferralCabinet, "nom_cabinet" | "lat" | "lon">, index: number) {
  return `${c.nom_cabinet}-${c.lat ?? "x"}-${c.lon ?? "y"}-${index}`;
}

function ReferralPage() {
  const [ville, setVille] = useState("");
  const [demande, setDemande] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<ReferralEmail[]>([]);
  const [cabinets, setCabinets] = useState<ReferralCabinet[]>([]);
  const [cabinetsCount, setCabinetsCount] = useState(0);
  const [villeCenter, setVilleCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [history, setHistory] = useState<ReferralHistoryEntry[]>([]);
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthed()) return;
    fetchReferralHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  const mapPoints: CabinetMapPoint[] = useMemo(
    () =>
      cabinets
        // Annotation nécessaire : sans elle, TS infère `adresse` comme requis sur l'objet
        // littéral et le prédicat du `filter` ne colle plus à CabinetMapPoint.
        .map((c, i): CabinetMapPoint | null => {
          if (c.lat == null || c.lon == null) return null;
          return {
            id: cabinetId(c, i),
            nom_cabinet: c.nom_cabinet,
            adresse: c.adresse,
            telephone: c.telephone,
            site_web: c.site_web,
            email: c.email,
            lat: c.lat,
            lon: c.lon,
            distance_km: c.distance_km,
            source: c.source,
          };
        })
        .filter((p): p is CabinetMapPoint => p != null),
    [cabinets],
  );

  const hasResults = !loading && emails.length > 0;

  function openHistoryEntry(h: ReferralHistoryEntry) {
    if (h.status !== "termine") return;
    setError(null);
    setLoading(false);
    setVille(h.ville);
    setDemande(h.demande);
    setEmails(h.emails ?? []);
    setCabinets(h.cabinets ?? []);
    setCabinetsCount(h.cabinets_count ?? h.emails?.length ?? 0);
    if (h.ville_lat != null && h.ville_lon != null) {
      setVilleCenter({ lat: h.ville_lat, lon: h.ville_lon });
    } else {
      setVilleCenter(null);
    }
    setSelectedCabinetId(null);
    setExpandedEmail(null);
    setSelectedHistoryKey(h.created_at);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!ville.trim() || !demande.trim()) return;
    setLoading(true);
    setError(null);
    setEmails([]);
    setCabinets([]);
    setCabinetsCount(0);
    setVilleCenter(null);
    setSelectedCabinetId(null);
    setExpandedEmail(null);
    setSelectedHistoryKey(null);
    try {
      const res = await generateReferralEmails(ville.trim(), demande.trim());
      if (res.status === "echec") {
        setError(res.error || "Aucun cabinet trouvé.");
      } else {
        setEmails(res.emails);
        setCabinets(res.cabinets ?? []);
        setCabinetsCount(res.cabinets_count);
        if (res.ville_lat != null && res.ville_lon != null) {
          setVilleCenter({ lat: res.ville_lat, lon: res.ville_lon });
        }
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

  function selectCabinetFromMap(id: string) {
    setSelectedCabinetId(id);
    const idx = cabinets.findIndex((c, i) => cabinetId(c, i) === id);
    if (idx >= 0) {
      const matchEmail = emails.findIndex(
        (em) => em.destinataire.trim().toLowerCase() === cabinets[idx].nom_cabinet.trim().toLowerCase(),
      );
      setExpandedEmail(matchEmail >= 0 ? matchEmail : idx);
      document.getElementById(`referral-email-${matchEmail >= 0 ? matchEmail : idx}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }

  return (
    <AppShell>
      <section className="animate-rise relative mb-8 overflow-hidden rounded-2xl text-ink-foreground">
        <div className="absolute inset-0" style={{ background: "var(--gradient-ink)" }} aria-hidden />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-16 bottom-[-50%] h-[120%] w-[55%] rounded-full opacity-35 blur-3xl"
          style={{ background: "var(--gradient-safran)" }}
          aria-hidden
        />
        <div className="relative px-5 py-5 sm:px-7 sm:py-6">
          <p className="font-display text-safran text-xs tracking-wide">LedgerMind</p>
          <h1 className="mt-1.5 max-w-xl text-balance font-display text-[clamp(1.25rem,2.8vw,1.7rem)] leading-snug">
            Le cabinet qui lit vos{" "}
            <span className="italic text-safran">vues</span>
            {" "}comme un bilan.
          </h1>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-ink-foreground/70 sm:text-[13px]">
            Influence, UGC, live, affiliation — on trouve un expert-comptable près de vous et on
            rédige le premier message. Pas de jargon cabinet, juste un brief créateur clair.
          </p>
          <p className="mt-3 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-ink-foreground/40">
            Sponsos · Multi-plateformes · Micro · URSSAF
          </p>
        </div>
      </section>

      <div className="grid items-start gap-12 lg:grid-cols-12">
        <div className="space-y-10 lg:col-span-7">
          <form onSubmit={handleGenerate} className="animate-slide-up space-y-6">
            <div>
              <label htmlFor="referral-ville" className="rule-label text-accent-ink">
                Base de tournage
              </label>
              <input
                id="referral-ville"
                type="text"
                value={ville}
                onChange={(e) => setVille(e.target.value)}
                placeholder="Votre ville"
                className="mt-3 w-full border-b-2 border-border bg-transparent py-3 font-display text-3xl tracking-tight transition-colors placeholder:text-muted-foreground/40 focus:border-accent focus:outline-none"
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
                {VILLES_RAPIDES.map((v, i) => (
                  <span key={v} className="inline-flex items-center">
                    {i > 0 && <span className="mx-2 text-border" aria-hidden>/</span>}
                    <button
                      type="button"
                      onClick={() => setVille(v)}
                      className={cn(
                        "font-medium transition-colors",
                        ville === v
                          ? "text-accent-ink underline decoration-accent decoration-2 underline-offset-4"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {v}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="referral-demande" className="rule-label text-accent-ink">
                Votre besoin
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Contexte pour les emails générés — décrivez votre activité et ce que vous
                attendez du cabinet.
              </p>
              <textarea
                id="referral-demande"
                rows={2}
                value={demande}
                onChange={(e) => setDemande(e.target.value)}
                placeholder="Ex. : créateur multi-plateformes en micro, besoin d’aide sur sponsos et URSSAF…"
                className="mt-3 w-full resize-none rounded-xl border border-border bg-card/80 px-3 py-2.5 text-sm leading-relaxed transition-colors focus:border-ink focus:outline-none"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              variant="accent"
              disabled={loading || !ville.trim() || !demande.trim()}
              className="rounded-full px-8"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" /> Recherche en cours…
                </>
              ) : (
                <>
                  <MapPinned /> Cartographier les cabinets
                </>
              )}
            </Button>
          </form>

          {error && (
            <div
              role="alert"
              className="animate-fade-in rounded-2xl border border-destructive/30 bg-destructive/8 px-5 py-4 text-sm font-medium text-destructive"
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="animate-fade-in relative overflow-hidden border border-border bg-card px-6 py-14 text-center">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
                <div className="h-full w-1/3 animate-[lm-sweep_1.4s_ease-in-out_infinite] bg-accent" />
              </div>
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="mt-4 font-display text-xl">On scanne {ville || "votre ville"}…</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Cabinets locaux + messages prêts à coller dans votre boîte mail.
              </p>
            </div>
          )}

          {hasResults && (
            <section className="space-y-6">
              <header className="border-b border-border pb-4">
                <p className="rule-label text-accent-ink">Casting comptable</p>
                <h2 className="mt-2 font-display text-2xl tracking-tight sm:text-3xl">
                  {cabinetsCount} cabinet{cabinetsCount > 1 ? "s" : ""} près de{" "}
                  <span className="italic text-accent-ink">{ville}</span>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {emails.length} message{emails.length > 1 ? "s" : ""} rédigé
                  {emails.length > 1 ? "s" : ""} — ouvrez, copiez, envoyez.
                </p>
              </header>

              <div className="space-y-3">
                {emails.map((em, i) => {
                  const linkedCabinetIdx = cabinets.findIndex(
                    (c) => c.nom_cabinet.trim().toLowerCase() === em.destinataire.trim().toLowerCase(),
                  );
                  const linkedId =
                    linkedCabinetIdx >= 0
                      ? cabinetId(cabinets[linkedCabinetIdx], linkedCabinetIdx)
                      : null;
                  const isSelected = linkedId != null && selectedCabinetId === linkedId;
                  const open = expandedEmail === i;
                  return (
                    <article
                      key={i}
                      id={`referral-email-${i}`}
                      style={{ animationDelay: `${i * 55}ms` }}
                      className={cn(
                        "chip-stagger overflow-hidden border bg-card transition-all duration-300",
                        isSelected || open
                          ? "border-primary shadow-lift"
                          : "border-border hover:border-ink/35",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedEmail(open ? null : i);
                          if (linkedId) setSelectedCabinetId(linkedId);
                        }}
                        aria-expanded={open}
                        className="flex w-full items-center gap-4 px-5 py-4 text-left"
                      >
                        <span
                          className={cn(
                            "num grid size-11 shrink-0 place-items-center text-sm font-semibold",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-foreground",
                          )}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-lg leading-tight">{em.destinataire}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {em.statut === "ok" ? (
                              <span className="text-success-ink">Message prêt</span>
                            ) : em.statut === "email_introuvable" ? (
                              <span className="text-amber-fiscal">Email introuvable — corps prêt quand même</span>
                            ) : (
                              <span className="text-destructive">Erreur de génération</span>
                            )}
                          </p>
                        </div>
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
                            open && "rotate-180",
                          )}
                        />
                      </button>

                      {open && (
                        <div className="animate-fade-in space-y-5 border-t border-border px-5 py-5">
                          <div className="border-l-2 border-accent/40 pl-4">
                            <p className="rule-label mb-2 text-muted-foreground">Coordonnées</p>
                            <CabinetContactLines
                              email={
                                linkedCabinetIdx >= 0
                                  ? cabinets[linkedCabinetIdx].email ?? em.email
                                  : em.email
                              }
                              site_web={
                                linkedCabinetIdx >= 0 ? cabinets[linkedCabinetIdx].site_web : null
                              }
                              telephone={
                                linkedCabinetIdx >= 0
                                  ? cabinets[linkedCabinetIdx].telephone
                                  : null
                              }
                            />
                          </div>
                          <div>
                            <p className="rule-label mb-1.5 text-muted-foreground">Objet</p>
                            <p className="font-medium">{em.objet}</p>
                          </div>
                          <div>
                            <p className="rule-label mb-2 text-muted-foreground">Pitch mail</p>
                            <pre className="whitespace-pre-wrap border border-border/70 bg-background/70 p-4 font-sans text-sm leading-relaxed">
                              {em.corps}
                            </pre>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={() => copyToClipboard(em.corps, i)}>
                              {copiedIdx === i ? (
                                <>
                                  <Check /> Copié
                                </>
                              ) : (
                                <>
                                  <Copy /> Copier le message
                                </>
                              )}
                            </Button>
                            {em.email && (
                              <Button asChild variant="accent">
                                <a
                                  href={`mailto:${em.email}?subject=${encodeURIComponent(em.objet)}&body=${encodeURIComponent(em.corps)}`}
                                >
                                  <Send /> Ouvrir dans Mail
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-10 lg:sticky lg:top-24 lg:col-span-5">
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="rule-label text-accent-ink">Terrain</p>
                <p className="mt-1 font-display text-xl">Carte des cabinets</p>
              </div>
              {mapPoints.length > 0 && (
                <span className="num text-xs text-muted-foreground">
                  {mapPoints.length} pin{mapPoints.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {!loading && cabinets.length > 0 ? (
              <CabinetsMap
                cabinets={mapPoints}
                center={villeCenter}
                selectedId={selectedCabinetId}
                onSelect={selectCabinetFromMap}
                heightClassName="h-[380px] sm:h-[460px]"
              />
            ) : (
              <div className="relative flex h-70 flex-col justify-end overflow-hidden border border-dashed border-border bg-secondary/30 px-6 py-6">
                {/* Fake street grid */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
                  aria-hidden
                >
                  <defs>
                    <pattern id="lm-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--primary)" strokeWidth="0.6" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#lm-map-grid)" />
                  <circle cx="62%" cy="42%" r="18" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
                  <circle cx="62%" cy="42%" r="4" fill="var(--accent)" />
                </svg>
                <p className="relative font-display text-lg">En attente de votre ville</p>
                <p className="relative mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Lancez la recherche : les cabinets s’affichent ici, marqueur calculatrice — un
                  clic ouvre le message.
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="rule-label mb-1 text-accent-ink">Archives</p>
            <p className="mb-4 font-display text-xl">Recherches passées</p>
            {history.length === 0 ? (
              <p className="border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
                Rien pour l’instant — vos prochaines recherches se rouvrent d’un clic.
              </p>
            ) : (
              <ul className="relative space-y-0 border-l border-border pl-5">
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => {
                    const active = selectedHistoryKey === h.created_at;
                    const canOpen = h.status === "termine" && (h.emails?.length ?? 0) > 0;
                    return (
                      <li key={`${h.created_at}-${i}`} className="relative pb-5 last:pb-0">
                        <span
                          className={cn(
                            "absolute left-[-1.4rem] top-1.5 size-2.5 rounded-full border-2 border-background",
                            active ? "bg-accent" : "bg-primary/40",
                          )}
                        />
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => openHistoryEntry(h)}
                          className={cn(
                            "w-full px-2 py-2 text-left transition-colors",
                            active ? "bg-accent/10" : "hover:bg-secondary/70",
                            !canOpen && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-display text-base">{h.ville}</span>
                            <span className="num text-[11px] text-muted-foreground">
                              {new Date(h.created_at).toLocaleDateString("fr-FR", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{h.demande}</p>
                          {canOpen && (
                            <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-widest text-teal-dark">
                              {active ? "Ouverte" : "Rouvrir"}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
