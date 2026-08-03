import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Markdown } from "@/components/lm/Markdown";
import { fetchMe, isAuthed } from "@/lib/auth";
import {
  fetchMySessions,
  fetchSessionDetail,
  getStoredSessionId,
  storeSessionId,
  type SessionDetail,
} from "@/lib/api";
import {
  creerFacture,
  listerFactures,
  telechargerFacturePdf,
  genererRapport,
  listerRapports,
  telechargerRapportPdf,
  genererDeclaration,
  listerDeclarations,
  marquerDeclarationRevue,
  telechargerDeclarationPdf,
  rechercherExpertsComptables,
  type Facture,
  type LigneFacture,
  type RapportActivite,
  type Declaration,
  type RechercheExpertsComptables,
} from "@/lib/facturation-api";

export const Route = createFileRoute("/activite")({
  head: () => ({
    meta: [
      { title: "Activité — LedgerMind" },
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

function ligneVide(): LigneFacture {
  return { designation: "", quantite: 1, prix_unitaire_ht: 0, taux_tva: 0, categorie: "prestation" };
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
function ActiviteGate() {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (cancelled) return;
        let sessionId = getStoredSessionId();
        if (!sessionId) {
          sessionId =
            me.agent_context.guidance.last_session_id ||
            me.agent_context.intake.last_session_id ||
            null;
        }
        if (!sessionId) {
          const sessions = await fetchMySessions();
          sessionId = sessions[0]?.session_id ?? null;
        }
        if (!sessionId) {
          if (!cancelled) setLoading(false);
          return;
        }
        storeSessionId(sessionId);
        const d = await fetchSessionDetail(sessionId);
        if (!cancelled) {
          setDetail(d);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const profile = detail?.profile ?? null;
  const isSirenVerified = profile?.verification_status === "verified";

  if (loading) {
    return (
      <AppShell>
        <PageHeader eyebrow="Activité" title="Chargement…" />
      </AppShell>
    );
  }

  if (!isSirenVerified) {
    return (
      <AppShell>
        <PageHeader
          eyebrow="Activité"
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
  const [dernierRapport, setDernierRapport] = useState<RapportActivite | null>(null);
  const [derniereDeclaration, setDerniereDeclaration] = useState<Declaration | null>(null);
  const [villePourExpert, setVillePourExpert] = useState("");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Activité"
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
        <EtapeRapport
          onGenere={setDernierRapport}
          onSuivant={() => setEtape("declaration")}
        />
      )}
      {etape === "declaration" && (
        <EtapeDeclaration
          rapportSource={dernierRapport}
          onGenere={setDerniereDeclaration}
          onDemanderExpert={(ville) => {
            setVillePourExpert(ville);
            setEtape("expert");
          }}
        />
      )}
      {etape === "expert" && (
        <EtapeExpertComptable
          villeInitiale={villePourExpert}
          declarationEnCours={derniereDeclaration}
        />
      )}
    </AppShell>
  );
}

// ------------------------------------------------------------------------------- 1. Facture

function EtapeFacture({ onSuivant }: { onSuivant: () => void }) {
  const [clientNom, setClientNom] = useState("");
  const [clientPro, setClientPro] = useState(false);
  const [lignes, setLignes] = useState<LigneFacture[]>([ligneVide()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derniere, setDerniere] = useState<Facture | null>(null);
  const [historique, setHistorique] = useState<Facture[]>([]);

  useEffect(() => {
    listerFactures()
      .then((r) => setHistorique(r.factures))
      .catch(() => {});
  }, []);

  function updateLigne(i: number, patch: Partial<LigneFacture>) {
    setLignes((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientNom.trim() || lignes.some((l) => !l.designation.trim())) return;
    setLoading(true);
    setError(null);
    try {
      const facture = await creerFacture({ client: { nom: clientNom.trim(), est_professionnel: clientPro }, lignes });
      setDerniere(facture);
      setHistorique((prev) => [facture, ...prev]);
      setClientNom("");
      setLignes([ligneVide()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la génération.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-12 gap-10 items-start">
      <div className="lg:col-span-7 space-y-6">
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 space-y-5">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Client</label>
            <input
              type="text"
              value={clientNom}
              onChange={(e) => setClientNom(e.target.value)}
              placeholder="Nom du client"
              className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border text-lg focus:outline-none focus:border-ink transition-colors"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={clientPro} onChange={(e) => setClientPro(e.target.checked)} />
              Client professionnel (mention TVA intracommunautaire si applicable)
            </label>
          </div>

          <div className="space-y-3">
            <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Prestations</label>
            {lignes.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="col-span-5 px-3 py-2 bg-background border border-transparent rounded-lg text-sm input-boxed"
                  placeholder="Désignation"
                  value={l.designation}
                  onChange={(e) => updateLigne(i, { designation: e.target.value })}
                />
                <input
                  className="col-span-2 px-3 py-2 bg-background border border-transparent rounded-lg text-sm input-boxed"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Qté"
                  value={l.quantite}
                  onChange={(e) => updateLigne(i, { quantite: Number(e.target.value) })}
                />
                <input
                  className="col-span-2 px-3 py-2 bg-background border border-transparent rounded-lg text-sm input-boxed"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="PU HT"
                  value={l.prix_unitaire_ht}
                  onChange={(e) => updateLigne(i, { prix_unitaire_ht: Number(e.target.value) })}
                />
                <select
                  className="col-span-3 px-2 py-2 bg-background border border-transparent rounded-lg text-sm input-boxed"
                  value={l.categorie}
                  onChange={(e) => updateLigne(i, { categorie: e.target.value as LigneFacture["categorie"] })}
                >
                  <option value="prestation">Prestation</option>
                  <option value="vente">Vente</option>
                </select>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLignes((prev) => [...prev, ligneVide()])}
              className="text-sm text-teal-dark font-medium hover:underline"
            >
              + Ajouter une ligne
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || !clientNom.trim()}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all duration-200 hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            {loading ? "Génération…" : "Générer la facture"}
          </button>
        </form>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 text-sm text-destructive font-medium">
            {error}
          </div>
        )}

        {derniere && (
          <section className="bg-card border border-border rounded-2xl p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xl">Facture {derniere.numero}</h3>
              <Provenance>facture_generee</Provenance>
            </div>
            <p className="text-sm text-muted-foreground">
              Total HT {derniere.total_ht.toFixed(2)} € · TVA {derniere.total_tva.toFixed(2)} € · Total TTC{" "}
              {derniere.total_ttc.toFixed(2)} €
            </p>
            <div className="space-y-2">
              {derniere.mentions.map((m) => (
                <div key={m.cle} className="text-xs border-l-2 border-teal-dark/40 pl-3">
                  <span className="font-medium">{m.libelle} :</span> {m.valeur}
                  <span className="text-muted-foreground"> — source : {m.source}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => telechargerFacturePdf(derniere.id, derniere.numero)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              >
                Télécharger le PDF
              </button>
              <button
                type="button"
                onClick={onSuivant}
                className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:border-ink transition-all duration-200 active:scale-[0.97]"
              >
                Étape suivante : rapport →
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-4">
        <h3 className="rule-label text-accent-ink">
          Factures émises
        </h3>
        {historique.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground text-sm">
            Aucune facture émise pour l'instant.
          </div>
        ) : (
          <div className="space-y-3">
            {historique.map((f) => (
              <div key={f.id} className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between card-hover">
                <div>
                  <p className="num text-sm font-medium">{f.numero}</p>
                  <p className="text-xs text-muted-foreground">{f.client.nom} · {f.total_ttc.toFixed(2)} € TTC</p>
                </div>
                <button
                  type="button"
                  onClick={() => telechargerFacturePdf(f.id, f.numero)}
                  className="text-xs text-teal-dark font-medium hover:underline"
                >
                  PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- 2. Rapport

function EtapeRapport({
  onGenere,
  onSuivant,
}: {
  onGenere: (r: RapportActivite) => void;
  onSuivant: () => void;
}) {
  const [dateDebut, setDateDebut] = useState(firstOfMonthIso());
  const [dateFin, setDateFin] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportActivite | null>(null);
  const [historique, setHistorique] = useState<RapportActivite[]>([]);

  useEffect(() => {
    listerRapports()
      .then((r) => setHistorique(r.rapports))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await genererRapport(dateDebut, dateFin);
      setRapport(r);
      onGenere(r);
      setHistorique((prev) => [r, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la génération du rapport.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-12 gap-10 items-start">
      <div className="lg:col-span-7 space-y-6">
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Depuis</label>
              <input
                type="date"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border focus:outline-none focus:border-ink transition-colors"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Jusqu'au</label>
              <input
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border focus:outline-none focus:border-ink transition-colors"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all duration-200 hover:brightness-[1.04] active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
          >
            {loading ? "Consolidation…" : "Générer le rapport"}
          </button>
        </form>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 text-sm text-destructive font-medium">
            {error}
          </div>
        )}

        {rapport && (
          <section className="bg-card border border-border rounded-2xl p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xl">
                Rapport {rapport.date_debut} → {rapport.date_fin}
              </h3>
              <Provenance>rapport_genere</Provenance>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {rapport.chiffres_cles.map((c) => (
                <div key={c.cle} className="bg-background rounded-xl p-4">
                  <p className="rule-label text-muted-foreground">{c.libelle}</p>
                  <p className="num font-medium">{c.valeur}</p>
                </div>
              ))}
            </div>
            {rapport.signaux_conformite.length > 0 && (
              <div className="space-y-2">
                {rapport.signaux_conformite.map((s, i) => (
                  <div key={i} className="text-xs bg-amber-fiscal/10 border border-amber-fiscal/30 rounded-lg p-3">
                    <span className="font-semibold">{s.label} :</span> {s.question}
                  </div>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-2">Appréciation</p>
              <Markdown text={rapport.appreciation} className="text-sm leading-relaxed" />
            </div>
            {rapport.sources.length > 0 && (
              <p className="text-xs text-muted-foreground">Sources : {rapport.sources.join(", ")}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => telechargerRapportPdf(rapport.id, rapport.date_debut, rapport.date_fin)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              >
                Télécharger le PDF
              </button>
              <button
                type="button"
                onClick={onSuivant}
                className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:border-ink transition-all duration-200 active:scale-[0.97]"
              >
                Étape suivante : déclaration →
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-4">
        <h3 className="rule-label text-accent-ink">
          Rapports générés
        </h3>
        {historique.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground text-sm">
            Aucun rapport pour l'instant.
          </div>
        ) : (
          <div className="space-y-3">
            {historique.map((r) => (
              <div key={r.id} className="bg-card border border-border rounded-2xl p-5 card-hover">
                <p className="font-semibold text-sm">{r.date_debut} → {r.date_fin}</p>
                <p className="text-xs text-muted-foreground">{r.total_ttc.toFixed(2)} € TTC · {r.nb_factures} facture(s)</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- 3. Déclaration

function EtapeDeclaration({
  rapportSource,
  onGenere,
  onDemanderExpert,
}: {
  rapportSource: RapportActivite | null;
  onGenere: (d: Declaration) => void;
  onDemanderExpert: (villeSuggeree: string) => void;
}) {
  const [dateDebut, setDateDebut] = useState(rapportSource?.date_debut ?? firstOfMonthIso());
  const [dateFin, setDateFin] = useState(rapportSource?.date_fin ?? todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  const [revue, setRevue] = useState(false);
  const [historique, setHistorique] = useState<Declaration[]>([]);

  useEffect(() => {
    listerDeclarations()
      .then((r) => setHistorique(r.declarations))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const d = await genererDeclaration(dateDebut, dateFin, rapportSource?.id);
      setDeclaration(d);
      setRevue(false);
      onGenere(d);
      setHistorique((prev) => [d, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la préparation de la déclaration.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMarquerRevue() {
    if (!declaration) return;
    const d = await marquerDeclarationRevue(declaration.id);
    setDeclaration(d);
    setRevue(true);
  }

  return (
    <div className="grid lg:grid-cols-12 gap-10 items-start">
      <div className="lg:col-span-7 space-y-6">
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Depuis</label>
              <input
                type="date"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border focus:outline-none focus:border-ink transition-colors"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Jusqu'au</label>
              <input
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
                className="w-full mt-2 px-0 py-3 bg-transparent border-b border-border focus:outline-none focus:border-ink transition-colors"
              />
            </div>
          </div>
          {rapportSource && (
            <p className="text-xs text-muted-foreground">
              Consolidée depuis le rapport {rapportSource.date_debut} → {rapportSource.date_fin}.
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all duration-200 hover:brightness-[1.04] active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
          >
            {loading ? "Préparation…" : "Préparer la déclaration"}
          </button>
        </form>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 text-sm text-destructive font-medium">
            {error}
          </div>
        )}

        {declaration && (
          <section className="bg-card border border-border rounded-2xl p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xl">{declaration.formulaire} — {declaration.regime}</h3>
              <Provenance>declaration_generee</Provenance>
            </div>
            <div className="bg-amber-fiscal/10 border border-amber-fiscal/30 rounded-xl p-4 text-xs">
              <span className="font-semibold uppercase tracking-widest">
                {declaration.statut === "brouillon" ? "Brouillon — à relire" : declaration.statut}
              </span>
              <p className="mt-1 text-muted-foreground">{declaration.avertissement}</p>
            </div>
            <div className="space-y-2">
              {declaration.lignes.map((l) => (
                <div key={l.case} className="flex items-start justify-between border-b border-border py-2 text-sm">
                  <div>
                    <p className="font-medium">
                      Case {l.case} — {l.libelle}
                    </p>
                    <p className="text-xs text-muted-foreground">Provenance : {l.provenance}</p>
                  </div>
                  <span className="num font-medium">{l.montant.toFixed(2)} €</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Source du formulaire : {declaration.source_formulaire}</p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => telechargerDeclarationPdf(declaration.id, declaration.date_debut, declaration.date_fin)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              >
                Télécharger le PDF
              </button>
              {!revue ? (
                <button
                  type="button"
                  onClick={handleMarquerRevue}
                  className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:border-ink transition-all duration-200 active:scale-[0.97]"
                >
                  J'ai relu chaque montant
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onDemanderExpert("")}
                  className="px-5 py-2.5 border border-teal-dark text-teal-dark rounded-lg text-sm font-medium hover:bg-teal-dark hover:text-ink-foreground transition-all duration-200 active:scale-[0.97]"
                >
                  Faire vérifier / signer par un expert-comptable →
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-4">
        <h3 className="rule-label text-accent-ink">
          Déclarations préparées
        </h3>
        {historique.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground text-sm">
            Aucune déclaration préparée pour l'instant.
          </div>
        ) : (
          <div className="space-y-3">
            {historique.map((d) => (
              <div key={d.id} className="bg-card border border-border rounded-2xl p-5 card-hover">
                <p className="font-semibold text-sm">{d.date_debut} → {d.date_fin}</p>
                <p className="text-xs text-muted-foreground">
                  {d.total_ca_declare.toFixed(2)} € déclarés · {d.statut}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- 4. Expert-comptable

function EtapeExpertComptable({
  villeInitiale,
  declarationEnCours,
}: {
  villeInitiale: string;
  declarationEnCours: Declaration | null;
}) {
  const [ville, setVille] = useState(villeInitiale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultat, setResultat] = useState<RechercheExpertsComptables | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ville.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResultat(await rechercherExpertsComptables(ville.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la recherche.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {declarationEnCours && (
        <p className="text-sm text-muted-foreground">
          Déclaration {declarationEnCours.date_debut} → {declarationEnCours.date_fin} à faire vérifier.
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
            <div className="grid md:grid-cols-2 gap-4">
              {resultat.cabinets.map((c, i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-6 space-y-2 card-hover">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{c.nom_cabinet}</p>
                    {c.distance_km != null && (
                      <span className="num text-xs text-muted-foreground">{c.distance_km} km</span>
                    )}
                  </div>
                  {c.adresse && <p className="text-sm text-muted-foreground">{c.adresse}</p>}
                  {c.telephone && <p className="text-sm text-muted-foreground">{c.telephone}</p>}
                  {c.site_web && (
                    <a href={c.site_web} target="_blank" rel="noreferrer" className="text-sm text-teal-dark hover:underline">
                      {c.site_web}
                    </a>
                  )}
                  <p className="rule-label text-muted-foreground/70">Source : {c.source}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
