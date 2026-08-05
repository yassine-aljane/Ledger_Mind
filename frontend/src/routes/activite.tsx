import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { CabinetsMap } from "@/components/lm/CabinetsMap";
import { CabinetContactLines, type CabinetMapPoint } from "@/components/lm/cabinets";
import { FactureCycleVie } from "@/components/lm/FactureCycleVie";
import { DeclarationsPanel } from "@/components/lm/Declarations";
import { RapportFiscalPanel } from "@/components/lm/RapportFiscal";
import { fetchMe, getStoredUser, isAuthed, isSirenVerified } from "@/lib/auth";
import {
  fetchMySessions,
  fetchSessionDetail,
  getStoredSessionId,
  storeSessionId,
  type SessionDetail,
} from "@/lib/api";
import {
  rechercherExpertsComptables,
  type RechercheExpertsComptables,
} from "@/lib/facturation-api";

export const Route = createFileRoute("/activite")({
  head: () => ({
    meta: [
      { title: "Facturation — LedgerMind" },
      {
        name: "description",
        content: "Facture, rapport d'activité, déclaration préparée et mise en relation expert-comptable.",
      },
    ],
  }),
  component: ActiviteRoute,
});

function ActiviteRoute() {
  return (
    <AccessGate feature="activite" premiumKind="activite">
      <ActivitePage />
    </AccessGate>
  );
}

type Etape = "facture" | "rapport" | "declaration" | "expert";

const ETAPES: { id: Etape; n: number; label: string }[] = [
  { id: "facture", n: 1, label: "Facture" },
  { id: "rapport", n: 2, label: "Rapport" },
  { id: "declaration", n: 3, label: "Déclaration" },
  { id: "expert", n: 4, label: "Expert-comptable" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function Provenance({ children }: { children: React.ReactNode }) {
  return (
    <span className="rule-label rounded-full bg-primary/10 px-2 py-0.5 text-primary">
      {children}
    </span>
  );
}

function ActivitePage() {
  return <ActiviteGate />;
}

/** L'espace facture/rapport/déclaration ne concerne que les profils SIREN vérifiés — la guidance
 * (« pas encore immatriculé ») reste sur ses propres écrans, inchangés. */
function profileFromUser(user: ReturnType<typeof getStoredUser>) {
  const raw = user?.agent_context?.intake?.profile;
  if (!raw || typeof raw !== "object") return null;
  return raw as SessionDetail["profile"];
}

function ActiviteGate() {
  const navigate = useNavigate();
  const cachedUser = typeof window !== "undefined" ? getStoredUser() : null;
  const [profile, setProfile] = useState<SessionDetail["profile"] | null>(() =>
    profileFromUser(cachedUser),
  );
  // Cache-first : si le compte local dit déjà « SIREN vérifié », on affiche tout de suite —
  // plus de waterfall fetchMe → session/detail qui bloquait l'écran plusieurs secondes.
  const [loading, setLoading] = useState(() => !isSirenVerified(cachedUser));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // Affichage immédiat depuis le cache, puis refresh réseau en arrière-plan.
        const local = getStoredUser();
        if (isSirenVerified(local)) {
          const localProfile = profileFromUser(local);
          if (localProfile && !cancelled) {
            setProfile(localProfile);
            setLoading(false);
          }
        }

        const me = await fetchMe();
        if (cancelled) return;

        let sessionId =
          getStoredSessionId() ||
          me.agent_context.intake.last_session_id ||
          me.agent_context.guidance.last_session_id ||
          null;
        if (!sessionId) {
          const sessions = await fetchMySessions();
          sessionId = sessions[0]?.session_id ?? null;
        }

        if (sessionId) {
          storeSessionId(sessionId);
          const d = await fetchSessionDetail(sessionId);
          if (!cancelled) setProfile(d.profile);
        } else if (!cancelled) {
          setProfile(profileFromUser(me));
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          // Si le cache suffisait déjà, on garde l'écran utile ; sinon on montre l'erreur.
          if (isSirenVerified(getStoredUser()) && profileFromUser(getStoredUser())) {
            setLoading(false);
          } else {
            setLoadError(err instanceof Error ? err.message : "Impossible de charger votre dossier.");
            setLoading(false);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const isVerified = isSirenVerified(getStoredUser()) || profile?.verification_status === "verified";

  if (loading) {
    return (
      <AppShell>
        <PageHeader eyebrow="Facturation" title="Chargement…" />
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <PageHeader eyebrow="Facturation" title="Connexion impossible" description={loadError} />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground"
          >
            Réessayer
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isVerified || !profile) {
    return (
      <AppShell>
        <PageHeader
          eyebrow="Facturation"
          title={
            <>
              Réservé aux profils <span className="italic font-normal">immatriculés.</span>
            </>
          }
          description="La facturation, le rapport d'activité et la déclaration préparée s'appuient sur un SIREN vérifié — votre identité fiscale exacte (dénomination, forme juridique, régime)."
        />
        <div className="bg-card border border-border rounded-2xl p-10 text-center space-y-4">
          <p className="text-muted-foreground max-w-xl mx-auto">
            Votre profil n'est pas encore vérifié auprès du répertoire Sirene. Une fois la
            vérification faite, ce parcours (facture → rapport → déclaration → expert-comptable)
            devient disponible.
          </p>
          <Link
            to="/onboarding/verification"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
          >
            Lancer la vérification SIREN
          </Link>
        </div>
      </AppShell>
    );
  }

  return <ActiviteJourney profile={profile} />;
}

function ActiviteJourney({ profile }: { profile: NonNullable<SessionDetail["profile"]> }) {
  const [etape, setEtape] = useState<Etape>("facture");
  // La période du dernier rapport établi préremplit la déclaration : les deux doivent porter
  // sur le même intervalle, sans quoi les montants ne se correspondent plus.
  const [periodeRapport, setPeriodeRapport] = useState<{ debut: string; fin: string } | null>(null);
  const [villePourExpert, setVillePourExpert] = useState("");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Facturation"
        title={
          <>
            De la facture <span className="italic font-normal">à la déclaration.</span>
          </>
        }
        description={`${profile.denomination ?? "Votre activité"} · SIREN ${profile.siren ?? "—"} · ${
          profile.recommended_regime ?? profile.tax_category ?? "régime en cours de qualification"
        }`}
      />

      <nav className="flex flex-wrap gap-2 mb-10">
        {ETAPES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEtape(e.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${
              etape === e.id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card border-border text-muted-foreground hover:border-ink"
            }`}
          >
            <span
              className={`num flex size-5 items-center justify-center rounded-full text-xs ${
                etape === e.id ? "bg-background text-ink" : "bg-background text-muted-foreground"
              }`}
            >
              {e.n}
            </span>
            {e.label}
          </button>
        ))}
      </nav>

      {etape === "facture" && <EtapeFacture onSuivant={() => setEtape("rapport")} />}
      {etape === "rapport" && (
        <RapportFiscalPanel
          onPeriodeGeneree={(debut, fin) => setPeriodeRapport({ debut, fin })}
          onSuivant={() => setEtape("declaration")}
        />
      )}
      {etape === "declaration" && <DeclarationsPanel periodeInitiale={periodeRapport} />}
      {etape === "expert" && (
        <EtapeExpertComptable
          villeInitiale={villePourExpert}
          periodeDeclaration={periodeRapport}
        />
      )}
    </AppShell>
  );
}

// ------------------------------------------------------------------------------- 1. Facture

// Le cycle de vie complet (brouillon -> emission -> reglement / avoir) vit dans son propre
// composant : cet ecran n'est plus qu'un aiguillage entre les quatre etapes.
function EtapeFacture({ onSuivant }: { onSuivant: () => void }) {
  return <FactureCycleVie onSuivant={onSuivant} />;
}

// ------------------------------------------------------------------------- 4. Expert-comptable

function EtapeExpertComptable({
  villeInitiale,
  periodeDeclaration,
}: {
  villeInitiale: string;
  periodeDeclaration: { debut: string; fin: string } | null;
}) {
  const [ville, setVille] = useState(villeInitiale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultat, setResultat] = useState<RechercheExpertsComptables | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ville.trim()) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      setResultat(await rechercherExpertsComptables(ville.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la recherche.");
    } finally {
      setLoading(false);
    }
  }

  const mapPoints: CabinetMapPoint[] = (resultat?.cabinets ?? [])
    // Type de retour annoté : sans lui, l'objet produit déclare `adresse` comme
    // requis-mais-nullable, ce que `CabinetMapPoint` (où il est optionnel) ne
    // satisfait pas — et le prédicat du `filter` devient invalide.
    .map((c, i): CabinetMapPoint | null => {
      if (c.lat == null || c.lon == null) return null;
      return {
        id: `${c.nom_cabinet}-${i}`,
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
    .filter((p): p is CabinetMapPoint => p != null);

  return (
    <div className="space-y-6">
      {periodeDeclaration && (
        <p className="text-sm text-muted-foreground">
          Période {periodeDeclaration.debut} → {periodeDeclaration.fin} à faire vérifier.
        </p>
      )}
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 flex gap-4 items-end">
        <div className="flex-1">
          <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Ville</label>
          <input
            type="text"
            value={ville}
            onChange={(e) => setVille(e.target.value)}
            placeholder="ex. Lyon, Marseille, Bordeaux…"
            className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border text-lg focus:outline-none focus:border-ink transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !ville.trim()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all duration-200 hover:brightness-[1.04] active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
        >
          {loading ? "Recherche…" : "Chercher"}
        </button>
      </form>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 text-sm text-destructive font-medium">
          {error}
        </div>
      )}

      {resultat && (
        <div className="space-y-4">
          <div className="bg-amber-fiscal/10 border border-amber-fiscal/30 rounded-xl p-4 text-xs text-muted-foreground">
            {resultat.avertissement}{" "}
            <a
              href={resultat.annuaire_officiel_url}
              target="_blank"
              rel="noreferrer"
              className="text-teal-dark font-semibold hover:underline"
            >
              {resultat.annuaire_officiel_label}
            </a>
          </div>
          {resultat.cabinets.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground text-sm">
              Aucun cabinet trouvé près de « {resultat.ville_recherchee} ». Consultez l'annuaire officiel.
            </div>
          ) : (
            <div className="grid lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5 lg:sticky lg:top-24">
                <CabinetsMap
                  cabinets={mapPoints}
                  center={
                    resultat.ville_lat != null && resultat.ville_lon != null
                      ? { lat: resultat.ville_lat, lon: resultat.ville_lon }
                      : null
                  }
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
                {resultat.cabinets.map((c, i) => {
                  const id = `${c.nom_cabinet}-${i}`;
                  const selected = selectedId === id;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={`bg-card border rounded-2xl p-6 space-y-3 card-hover text-left transition-colors ${
                        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{c.nom_cabinet}</p>
                        {c.distance_km != null && (
                          <span className="num text-xs text-muted-foreground shrink-0">{c.distance_km} km</span>
                        )}
                      </div>
                      {c.adresse && <p className="text-sm text-muted-foreground">{c.adresse}</p>}
                      <CabinetContactLines email={c.email} site_web={c.site_web} telephone={c.telephone} />
                      <p className="rule-label text-muted-foreground/70">Source : {c.source}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
