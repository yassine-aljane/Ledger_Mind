import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  FileBarChart,
  FileText,
  Info,
  Lock,
  Minus,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FiscalReceipt } from "@/components/lm/FiscalReceipt";
import {
  AiresEmpilees,
  BarresClassement,
  ColonnesMensuelles,
  Donut,
  JaugeArc,
  Sparkline,
} from "@/components/lm/charts";
import {
  construireSynthese,
  etatSeuil,
  formatEuros,
  formatPct,
  indiceSante,
  PERIODES,
  type Periode,
  type PointMensuel,
  type SyntheseFinanciere,
} from "@/lib/finance";
import {
  listerDeclarations,
  listerFactures,
  listerRapports,
  type Declaration,
  type Facture,
  type RapportActivite,
} from "@/lib/facturation-api";
import {
  displayFirstName,
  fetchMe,
  getStoredUser,
  isAuthed,
  type AuthUser,
} from "@/lib/auth";
import {
  fetchMySessions,
  fetchSessionDetail,
  formatMoney,
  getStoredSessionId,
  loadCachedDiagnosticResult,
  storeSessionId,
  type ComplianceAlert,
  type DiagnosticProfile,
  type SessionDetail,
  type UserProfile,
} from "@/lib/api";
import type { Calcul, Qualification } from "@/lib/mocks";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Ma situation — LedgerMind" },
      { name: "description", content: "Votre situation fiscale et financière, en un coup d'œil." },
      { property: "og:title", content: "Ma situation — LedgerMind" },
      { property: "og:description", content: "Votre situation fiscale et financière, en un coup d'œil." },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <AccessGate feature="dashboard" premiumKind="dashboard">
      <DashboardPage />
    </AccessGate>
  );
}

// ------------------------------------------------------------------ Profil → reçu fiscal

function profileToQualification(profile: UserProfile): Qualification {
  const isBnc = profile.tax_category === "BNC" || profile.tax_category === "mixed";
  return {
    categorie: profile.recommended_regime ?? profile.tax_category ?? "Non classifié",
    imposable: true,
    tva_applicable: profile.international_clients === true,
    taux_tva: profile.international_clients ? 0.2 : 0,
    retenue_source_applicable: isBnc && profile.has_recurring_contracts === true,
    taux_rs: isBnc ? 0.1 : 0,
    base_legale: profile.tax_category === "BNC" ? "Art. 93 CGI — BNC" : "Art. 38 CGI — BIC",
    explication_simple:
      profile.tax_category_reason ?? "Votre profil fiscal a été qualifié par LedgerMind.",
  };
}

/** Reçu adossé au profil déclaré — utilisé tant qu'aucune facture réelle n'existe. */
function profileToCalcul(profile: UserProfile): Calcul {
  const monthlyStr = profile.estimated_monthly_revenue ?? "0";
  const digits = monthlyStr.replace(/[^\d]/g, "");
  const annualDigits = (profile.estimated_annual_revenue ?? "").replace(/[^\d]/g, "");
  const monthly = digits
    ? parseInt(digits, 10)
    : annualDigits
      ? Math.round(parseInt(annualDigits, 10) / 12)
      : 2500;
  const ht = monthly * 3;
  const tva = profile.international_clients ? ht * 0.2 : 0;
  const rs = profile.tax_category === "BNC" ? ht * 0.1 : 0;
  return {
    reference: `LM-${profile.siren ?? "NEW"}-${new Date().getFullYear()}`,
    client: profile.denomination ?? profile.activity_types[0] ?? "Votre activité",
    date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    montant_ht: ht,
    tva,
    retenue_source: rs,
    css: ht * 0.01,
    net_a_percevoir: ht + tva - rs - ht * 0.01,
    provision_conseillee: Math.round(ht * 0.22),
  };
}

/**
 * Reçu adossé à une facture RÉELLE émise depuis l'espace Facturation.
 *
 * Dès qu'une facture existe, le reçu cesse d'être une projection sur le revenu déclaré
 * pour devenir la lecture fiscale d'un document réellement émis — mêmes montants que le
 * PDF téléchargé, au centime près.
 */
function factureToCalcul(facture: Facture, profile: UserProfile): Calcul {
  const ht = facture.total_ht;
  const rs = profile.tax_category === "BNC" && profile.has_recurring_contracts ? ht * 0.1 : 0;
  const css = ht * 0.01;
  const emission = facture.date_emission ? new Date(facture.date_emission) : null;
  return {
    // Un document émis porte toujours un numéro ; le repli ne sert qu'à satisfaire le type.
    reference: facture.numero ?? "—",
    client: facture.client?.nom ?? "Client",
    date: emission
      ? emission.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—",
    montant_ht: ht,
    tva: facture.total_tva,
    retenue_source: rs,
    css,
    net_a_percevoir: facture.total_ttc - rs - css,
    provision_conseillee: Math.round(ht * 0.22),
  };
}

function emptyReceiptProfile(): UserProfile {
  return {
    siret: null,
    siren: null,
    denomination: null,
    legal_form: null,
    nature_juridique_code: null,
    is_entrepreneur_individuel: null,
    micro_eligible: null,
    registry_address: null,
    ape_code: null,
    activity_declared: null,
    creation_date: null,
    administrative_status: null,
    verification_status: null,
    registry_document_required: null,
    registry_document_uploaded: false,
    registry_document_type: null,
    kbis_obtained: null,
    rcs_registered: null,
    registry_tax_base: null,
    sirene_document_uploaded: false,
    sirene_document_activity_label: null,
    sirene_document_address: null,
    sirene_document_registration_date: null,
    activity_types: [],
    has_secondary_activity: null,
    secondary_activity_types: [],
    main_activity_commercial: null,
    revenue_sources: [],
    currencies: [],
    estimated_monthly_revenue: null,
    estimated_annual_revenue: null,
    revenue_variability: null,
    invoices_already_issued: null,
    first_income_date: null,
    has_recurring_contracts: null,
    in_kind_gifts: null,
    international_clients: null,
    tax_category: null,
    tax_category_reason: null,
    recommended_regime: null,
    regime_plafond: null,
    fiscal_classification_status: null,
    fiscal_inconsistency_reason: null,
    activity_mismatch: false,
    mismatches: [],
    compliance_alerts: [],
    recommended_actions: [],
  };
}

function formatCaLabel(diag: DiagnosticProfile | null, profile: UserProfile): string {
  if (diag?.ca_estime_annuel != null) {
    return `≈ ${Math.round(diag.ca_estime_annuel).toLocaleString("fr-FR")} € / an`;
  }
  if (profile.estimated_annual_revenue) return profile.estimated_annual_revenue;
  if (profile.estimated_monthly_revenue) return `${profile.estimated_monthly_revenue} / mois`;
  return "—";
}

// ------------------------------------------------------------------------------ Page

function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorties de l'espace Facturation. Leur absence n'est jamais une erreur d'écran : un
  // dossier tout neuf n'a simplement encore rien produit, et le cockpit doit le dire
  // plutôt que d'afficher un bandeau rouge.
  const [factures, setFactures] = useState<Facture[]>([]);
  const [rapports, setRapports] = useState<RapportActivite[]>([]);
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [chargementActivite, setChargementActivite] = useState(true);

  const [periode, setPeriode] = useState<Periode>("12m");

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me);

        let sessionId = getStoredSessionId();
        if (!sessionId) {
          const fromCtx =
            me.agent_context.guidance.last_session_id || me.agent_context.intake.last_session_id;
          if (fromCtx) sessionId = fromCtx;
        }
        if (!sessionId) {
          const sessions = await fetchMySessions();
          sessionId = sessions[0]?.session_id ?? null;
        }

        if (!sessionId) {
          if (!cancelled) {
            setDetail(null);
            setLoading(false);
          }
          return;
        }

        storeSessionId(sessionId);
        try {
          const d = await fetchSessionDetail(sessionId);
          if (!cancelled) {
            setDetail(d);
            setLoading(false);
          }
        } catch {
          // L'identifiant mémorisé peut appartenir à un AUTRE compte (403) ou avoir disparu
          // (404) : `fetchSessionDetail` vient alors de l'oublier. On redemande donc au
          // serveur une session qui nous appartient VRAIMENT avant de renoncer — sans cette
          // seconde tentative, un identifiant périmé vidait le tableau de bord à chaque
          // rechargement, sans rien expliquer.
          let recharge: SessionDetail | null = null;
          try {
            const miennes = await fetchMySessions();
            const valide = miennes.find((s) => s.session_id !== sessionId)?.session_id
              ?? miennes[0]?.session_id;
            if (valide && valide !== sessionId) {
              storeSessionId(valide);
              recharge = await fetchSessionDetail(valide);
            }
          } catch {
            /* aucune session exploitable : on retombe sur le cache ci-dessous */
          }

          // Une session issue de la seule guidance (pas encore de SIREN vérifié) n'existe pas
          // côté orchestrateur : ce n'est pas une erreur pour l'utilisateur, juste un dossier
          // partiel. On retombe alors sur le résultat mis en cache par l'écran de diagnostic.
          if (!cancelled) {
            setDetail(recharge ?? loadCachedDiagnosticResult());
            setLoading(false);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger le dashboard.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Les trois listes sont indépendantes : on les charge en parallèle et chaque échec
  // n'emporte que sa propre section.
  useEffect(() => {
    if (!isAuthed()) return;
    let cancelled = false;

    (async () => {
      const [f, r, d] = await Promise.allSettled([
        listerFactures(),
        listerRapports(),
        listerDeclarations(),
      ]);
      if (cancelled) return;
      if (f.status === "fulfilled") setFactures(f.value.factures ?? []);
      if (r.status === "fulfilled") setRapports(r.value.rapports ?? []);
      if (d.status === "fulfilled") setDeclarations(d.value.declarations ?? []);
      setChargementActivite(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const profile = detail?.profile ?? null;
  const diag = detail?.diagnostic_profile ?? null;
  const branch = detail?.branch ?? null;
  const isGuidance = branch === "guidance";
  const greeting = displayFirstName(user);

  const hasPlan =
    (profile?.recommended_actions.length ?? 0) > 0 || Boolean(profile?.recommended_regime);
  const statusLabel = hasPlan || profile?.tax_category ? "à jour" : "en cours";

  const isSirenVerified = profile?.verification_status === "verified";
  const isGuidanceOnly = isGuidance && profile?.verification_status !== "verified";

  const synthese = useMemo(() => construireSynthese(factures, periode), [factures, periode]);
  const dernierRapport = rapports[0] ?? null;
  const seuil = useMemo(
    () => etatSeuil(dernierRapport, synthese, profile?.regime_plafond),
    [dernierRapport, synthese, profile?.regime_plafond],
  );
  const sante = useMemo(
    () => indiceSante(synthese, rapports, declarations, seuil),
    [synthese, rapports, declarations, seuil],
  );

  // `/api/declaration` a longtemps partagé sa collection Mongo avec l'agent « jeux de
  // déclarations », dont les documents n'ont ni `total_ca_declare` ni `statut`. On ne
  // rend la carte que pour un enregistrement réellement exploitable.
  const derniereDeclaration = useMemo(
    () => declarations.find((d) => d != null && typeof d.total_ca_declare === "number") ?? null,
    [declarations],
  );

  // Un dossier qui ne contient que des brouillons n'a rien à consolider : la synthèse
  // les exclut, donc l'écran doit rester sur son état vide plutôt que d'afficher des
  // graphiques à zéro.
  const aDesDonnees = synthese.nb_factures > 0 || synthese.nb_avoirs > 0;

  /**
   * La dernière facture ÉMISE pilote le reçu.
   *
   * Un brouillon n'a ni numéro ni date d'émission, et un avoir porte des montants
   * négatifs : ni l'un ni l'autre ne donne un reçu fiscal lisible.
   */
  const derniereFacture = useMemo(() => {
    const emises = factures.filter(
      (f) =>
        f.type_document === "facture" &&
        f.statut !== "brouillon" &&
        f.statut !== "annulee" &&
        Boolean(f.date_emission),
    );
    if (emises.length === 0) return null;
    return emises.sort(
      (a, b) =>
        new Date(b.date_emission as string).getTime() -
        new Date(a.date_emission as string).getTime(),
    )[0];
  }, [factures]);

  const profilReçu = profile ?? emptyReceiptProfile();
  const qualification = profileToQualification(profilReçu);
  const calcul = derniereFacture
    ? factureToCalcul(derniereFacture, profilReçu)
    : profileToCalcul(profilReçu);

  const pipeline = isGuidance
    ? [
        { l: "Diagnostic", done: true },
        { l: "Feuille de route", done: Boolean(detail?.roadmap) || hasPlan },
        { l: "Régime", done: Boolean(profile?.recommended_regime) },
        { l: "Actions", done: (profile?.recommended_actions.length ?? 0) > 0 },
      ]
    : [
        {
          l: "Vérification",
          done:
            profile?.verification_status === "verified" ||
            profile?.verification_status === "skipped",
        },
        { l: "Qualification", done: !!profile?.tax_category },
        { l: "Facturation", done: factures.length > 0 },
        { l: "Déclaration", done: declarations.length > 0 },
      ];

  return (
    <AppShell>
      <PageHeader
        eyebrow={`Bonjour, ${greeting}`}
        title={
          <>
            Votre situation est <span className="italic font-normal">{statusLabel}.</span>
          </>
        }
        description={
          profile?.recommended_regime
            ? `Régime recommandé : ${profile.recommended_regime}${
                profile.regime_plafond ? ` (plafond ${profile.regime_plafond})` : ""
              }.`
            : loading
              ? "Chargement de votre dossier…"
              : "Complétez le diagnostic ou la vérification SIREN pour alimenter ce tableau de bord."
        }
        actions={
          aDesDonnees ? (
            /* Le rapport fiscal relève du bilan, pas de la facturation : il se déclenche
               depuis ici, sur sa propre page. La facturation reste accessible par le rail. */
            <Button asChild variant="accent" className="rounded-full">
              <Link to="/rapport">
                <FileBarChart className="size-4" /> Générer un rapport
              </Link>
            </Button>
          ) : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="mb-8 flex items-start gap-2.5 rounded-xl border border-destructive/30 border-l-4 border-l-destructive bg-destructive/8 px-4 py-3.5 text-[0.9375rem] text-destructive"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {!loading && !detail && !error && (
        <div className="mb-10 space-y-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-[0.9375rem] text-muted-foreground">
            Aucune session trouvée pour votre compte.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/onboarding">
                Commencer l&apos;onboarding <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      )}

      {!loading && detail && isGuidanceOnly && (
        <div className="animate-rise mb-10 flex flex-col justify-between gap-4 rounded-2xl border border-accent/40 bg-accent/8 p-5 sm:flex-row sm:items-center">
          <div>
            <Badge variant="accent">
              <Lock /> Accès partiel
            </Badge>
            <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
              Votre diagnostic et votre feuille de route sont prêts. Le reçu fiscal, la catégorie
              précise et les alertes de conformité s&apos;activent après la vérification de votre
              SIREN et de votre avis de situation.
            </p>
          </div>
          <Button asChild className="shrink-0">
            <Link to="/onboarding/verification">
              <ShieldCheck /> Vérifier mon SIREN
            </Link>
          </Button>
        </div>
      )}

      {/* Un seul rang de filtres, au-dessus de tout ce qu'il cadre : chaque chiffre de
          l'écran est calculé sur la même tranche, donc les totaux s'accordent toujours. */}
      {aDesDonnees && (
        <FiltrePeriode valeur={periode} onChange={setPeriode} synthese={synthese} />
      )}

      {/* Une seule colonne sous 1280 px : à 1024 px, un rail 8/4 laissait le reçu (320 px fixes)
          dans une colonne de 300 px, donc rogné. Au-delà, 12 colonnes — 8 pour l'analyse,
          4 pour le reçu et l'avancement. Le reçu suit le contenu principal dans le DOM : il
          passe naturellement dessous quand la grille se replie. */}
      <div className="grid items-start gap-8 xl:grid-cols-12 xl:gap-10">
        <div className="space-y-8 xl:col-span-8">
          {aDesDonnees ? (
            <>
              <BentoHaut synthese={synthese} periode={periode} rapport={dernierRapport} />
              <CarteEvolution points={synthese.points} />
              <CarteSeuil seuil={seuil} regime={profile?.recommended_regime ?? profile?.tax_category} />
              {synthese.clients.length > 0 && (
                <CarteGraphe
                  titre="Concentration client"
                  soustitre="Un client qui pèse une part dominante de votre CA est un risque de trésorerie autant qu'un succès commercial."
                  index="03"
                >
                  <BarresClassement
                    items={synthese.clients.map((c) => ({
                      label: c.nom,
                      valeur: c.total_ht,
                    }))}
                  />
                </CarteGraphe>
              )}
              {dernierRapport && <SignauxConformite rapport={dernierRapport} />}
            </>
          ) : (
            <EtatVide
              chargement={chargementActivite}
              isSirenVerified={isSirenVerified}
              profile={profile}
              diag={diag}
              calcul={calcul}
            />
          )}

          {profile && isSirenVerified && profile.compliance_alerts.length > 0 && (
            <AlertesConformite alertes={profile.compliance_alerts} />
          )}

          <section className="animate-rise rounded-3xl border border-border bg-card p-6 shadow-soft">
            <div className="mb-6 flex items-center justify-between gap-3">
              <h2 className="text-xl sm:text-2xl">Pipeline de traitement</h2>
              <Badge variant="outline">
                {branch === "guidance"
                  ? "Branche B · Guidance"
                  : branch === "intake"
                    ? "Branche A · Intake"
                    : loading
                      ? "…"
                      : "En attente"}
              </Badge>
            </div>
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {pipeline.map((p) => (
                <li key={p.l} className="space-y-2.5">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-colors",
                      /* L'étape franchie porte la couleur ; celle qui reste porte la piste de
                         jauge — `border` était si proche du fond de carte qu'on ne voyait
                         même pas qu'il y avait une barre à remplir. */
                      p.done ? "bg-success" : "bg-dv-track",
                    )}
                  />
                  <span
                    className={cn(
                      "rule-label-lg flex items-center gap-1.5",
                      p.done ? "text-foreground" : "text-label-ink",
                    )}
                  >
                    {p.done && <Check className="size-3.5 shrink-0 text-success-ink" aria-hidden />}
                    {p.l}
                    <span className="sr-only">{p.done ? " : fait" : " : à faire"}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {profile && profile.recommended_actions.length > 0 && (
            <section className="animate-rise overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
              <div className="flex items-center justify-between gap-3 border-b border-border p-6">
                <h2 className="text-xl sm:text-2xl">Prochaines actions</h2>
                {isGuidance && (
                  <Link
                    to="/parametres"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Voir le profil <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
              <ul className="divide-y divide-border">
                {profile.recommended_actions.slice(0, 6).map((item) => (
                  <li
                    key={item.step}
                    className="flex items-center justify-between gap-4 p-6 transition-colors hover:bg-secondary/40"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="num grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[0.8125rem] text-label-ink">
                        {item.step.toString().padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[1.0625rem] font-medium">{item.title}</p>
                        {item.description ? (
                          <p className="truncate text-[0.9375rem] text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Colonne de droite : le reçu fiscal, inchangé dans son dessin, mais désormais
            alimenté par la dernière facture réellement émise quand il y en a une. */}
        <div className="animate-rise space-y-8 xl:sticky xl:top-24 xl:col-span-4">
          {loading ? (
            <SqueletteRecu />
          ) : isSirenVerified ? (
            <>
              <p className="rule-label-lg mb-6 text-center text-accent-ink">
                {derniereFacture ? "Dernière facture émise" : "Reçu fiscal — projection"}
              </p>
              <FiscalReceipt qualification={qualification} calcul={calcul} />
              {derniereFacture && (
                <p className="text-center text-sm text-muted-foreground">
                  Lecture fiscale de la facture {derniereFacture.numero}.{" "}
                  <Link to="/activite" className="font-medium text-primary hover:underline">
                    Voir toutes les factures
                  </Link>
                </p>
              )}
            </>
          ) : (
            <div className="space-y-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <p className="rule-label-lg text-label-ink">Reçu fiscal — verrouillé</p>
              <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                Ce document se génère une fois votre SIREN et votre avis de situation vérifiés.
              </p>
              <Button asChild>
                <Link to="/onboarding/verification">
                  <ShieldCheck /> Vérifier mon SIREN
                </Link>
              </Button>
            </div>
          )}

          {aDesDonnees && <CarteSante sante={sante} />}
          {derniereDeclaration && <CarteDeclaration declaration={derniereDeclaration} />}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Stat
              label="Catégorie fiscale"
              value={profile?.tax_category ?? profile?.recommended_regime ?? "—"}
            />
            <Stat
              label="Code APE"
              value={isSirenVerified ? (profile?.ape_code ?? "Non renseigné") : "Verrouillé"}
              mono={false}
              locked={!isSirenVerified}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------- Filtres

function FiltrePeriode({
  valeur,
  onChange,
  synthese,
}: {
  valeur: Periode;
  onChange: (p: Periode) => void;
  synthese: SyntheseFinanciere;
}) {
  return (
    <div className="animate-rise mb-8 flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Période analysée">
        {PERIODES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            title={p.aide}
            aria-pressed={valeur === p.id}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.97]",
              valeur === p.id
                ? "bg-primary text-primary-foreground shadow-soft"
                : "border border-border text-muted-foreground hover:border-ink hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
          <span className="relative inline-flex size-2 rounded-full bg-success-ink" />
        </span>
        <span className="num font-semibold text-foreground">{synthese.nb_factures}</span> facture
        {synthese.nb_factures > 1 ? "s" : ""} consolidée{synthese.nb_factures > 1 ? "s" : ""}
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------- Chiffre animé

/** Compteur qui monte à l'apparition — le geste « levée d'encre » appliqué aux chiffres. */
function Chiffre({ to, format }: { to: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const cible = useRef(to);

  useEffect(() => {
    cible.current = to;
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(to);
      return;
    }

    let raf = 0;
    const depart = performance.now();
    const from = 0;
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - depart) / dur);
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (cible.current - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);

  return <span ref={ref}>{format(value)}</span>;
}

/**
 * Variation face à la période précédente, sous forme de pastille.
 *
 * La couleur ne porte jamais le sens seule : la flèche donne la direction et le signe est
 * écrit dans le chiffre — la teinte ne fait que confirmer.
 */
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[0.8125rem] text-muted-foreground">
        <Minus className="size-3.5 shrink-0" aria-hidden /> pas d&apos;historique comparable
      </span>
    );
  }
  const positif = pct > 0;
  const neutre = Math.abs(pct) < 0.5;
  const Icone = neutre ? Minus : positif ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold",
          neutre
            ? "bg-secondary text-muted-foreground"
            : positif
              ? "bg-success/12 text-success-ink"
              : "bg-destructive/10 text-destructive",
        )}
      >
        <Icone className="size-3.5 shrink-0" aria-hidden />
        <span className="num">{formatPct(pct)}</span>
      </span>
      <span className="text-[0.8125rem] text-muted-foreground">vs période précédente</span>
    </span>
  );
}

// ------------------------------------------------------------------------ Bento du haut

/**
 * La grille bento du cockpit.
 *
 * Quatre tuiles identiques alignées sur deux rangs traitaient le CA, le nombre de factures
 * et la TVA comme quatre faits de même poids. Ils ne le sont pas : le CA est la réponse à
 * la question que l'utilisateur se pose en arrivant, les autres la nuancent. La grille est
 * donc asymétrique — un pavé principal deux tiers / un tiers, puis les indicateurs de
 * détail en dessous — et c'est la SURFACE qui porte la hiérarchie, pas seulement le corps
 * de la police.
 *
 * Chasse tabulaire malgré le serif du grand chiffre : le compteur d'apparition traverse
 * toutes les valeurs intermédiaires, et sans chiffres de largeur fixe le pavé tremble
 * pendant l'animation.
 */
function BentoHaut({
  synthese,
  periode,
  rapport,
}: {
  synthese: SyntheseFinanciere;
  periode: Periode;
  rapport: RapportActivite | null;
}) {
  const libelle = PERIODES.find((p) => p.id === periode)?.label ?? "";
  // La provision affichée vient du rapport quand il existe ; la micro-tendance ne suivrait
  // alors plus la même base de calcul, donc on ne la dessine pas plutôt que de mentir.
  const tendanceProvision = rapport ? undefined : synthese.points.map((p) => p.total_ht * 0.22);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
      {/* ---- Pavé principal : le CA de la période ---- */}
      <section className="animate-rise relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-soft sm:col-span-12 sm:p-8 lg:col-span-8">
        <div
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-safran)" }}
          aria-hidden
        />
        <div className="relative flex h-full flex-col justify-between gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="rule-label-lg text-label-ink">
              <span className="mr-2 inline-block h-px w-6 -translate-y-0.75 bg-accent align-middle" />
              Chiffre d&apos;affaires HT · {libelle}
            </p>
            <Delta pct={synthese.delta_ht_pct} />
          </div>

          <p
            className="font-display text-[clamp(3rem,6vw,4.75rem)] font-semibold leading-[0.9] tracking-tight"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <Chiffre to={synthese.total_ht} format={(n) => formatEuros(n)} />
          </p>

          {/* La courbe court sur toute la largeur du pavé : à 288 px elle décorait un coin,
              à pleine largeur elle devient la seconde lecture de la carte. */}
          <div>
            <Sparkline valeurs={synthese.points.map((p) => p.total_ht)} hauteur={72} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[0.8125rem] text-muted-foreground">
              <span>{synthese.points[0]?.labelLong ?? ""}</span>
              {synthese.meilleur_mois && (
                <span>
                  Meilleur mois : {synthese.meilleur_mois.labelLong} ·{" "}
                  <span className="num font-semibold text-foreground">
                    {formatEuros(synthese.meilleur_mois.total_ht)}
                  </span>
                </span>
              )}
              <span>{synthese.points[synthese.points.length - 1]?.labelLong ?? ""}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Pavé secondaire : la nature de l'activité, en anneau ---- */}
      <CarteNature
        prestations={synthese.prestations_ht}
        ventes={synthese.ventes_ht}
        total={synthese.total_ht}
        className="sm:col-span-12 lg:col-span-4"
      />

      {/* ---- Indicateurs de détail ---- */}
      <TuileKpi
        className="sm:col-span-6"
        label="Factures émises"
        icone={FileText}
        valeur={<Chiffre to={synthese.nb_factures} format={(n) => Math.round(n).toString()} />}
        tendance={synthese.points.map((p) => p.nb_factures)}
        detail={
          <div className="space-y-2">
            <Delta pct={synthese.delta_factures_pct} />
            <p>
              Panier moyen{" "}
              <span className="num font-semibold text-foreground">
                {formatEuros(synthese.panier_moyen)}
              </span>
              {synthese.nb_avoirs > 0 && (
                <>
                  {" · "}
                  {synthese.nb_avoirs} avoir{synthese.nb_avoirs > 1 ? "s" : ""} déduit
                  {synthese.nb_avoirs > 1 ? "s" : ""}
                </>
              )}
            </p>
          </div>
        }
      />
      <TuileKpi
        className="sm:col-span-6"
        label="Reste à encaisser"
        icone={Wallet}
        valeur={<Chiffre to={synthese.reste_a_encaisser} format={formatEuros} />}
        /* Pas de micro-tendance : l'encaissement n'a pas de série mensuelle dans la synthèse.
           On montre à la place la part déjà réglée, qui est la vraie question de trésorerie. */
        jauge={
          synthese.net_a_payer > 0
            ? { part: (synthese.montant_regle / synthese.net_a_payer) * 100, label: "réglé" }
            : undefined
        }
        detail={
          synthese.reste_a_encaisser <= 0
            ? "Tout est réglé sur la période"
            : `${formatEuros(synthese.montant_regle)} déjà réglés sur ${formatEuros(synthese.net_a_payer)}`
        }
      />
      <TuileKpi
        className="sm:col-span-6"
        label="TVA collectée"
        icone={Receipt}
        valeur={<Chiffre to={synthese.total_tva} format={formatEuros} />}
        tendance={synthese.total_tva > 0 ? synthese.points.map((p) => p.total_tva) : undefined}
        detail={
          synthese.total_tva === 0
            ? "Aucune TVA facturée — franchise en base probable"
            : "À reverser lors de votre prochaine déclaration"
        }
      />
      <TuileKpi
        className="sm:col-span-6"
        label={rapport ? "Cotisations estimées" : "Provision conseillée"}
        icone={Sparkles}
        accent
        valeur={
          <Chiffre
            to={rapport ? rapport.cotisations_estimees : synthese.total_ht * 0.22}
            format={formatEuros}
          />
        }
        tendance={tendanceProvision}
        detail={
          rapport
            ? "Calculé par votre dernier rapport d'activité"
            : "Estimation à 22 % — générez un rapport pour affiner"
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------------- Tuiles KPI

/**
 * Tuile d'indicateur : filet de couleur en tête, chiffre, puis SOIT une micro-tendance,
 * SOIT une mini-jauge — jamais rien de décoratif à cet emplacement.
 *
 * Une tuile sans série mensuelle exploitable reste sans graphique : un tracé plat inventé se
 * lirait comme une absence d'activité, ce qui n'est pas la même chose qu'une absence de
 * mesure.
 *
 * `flex-col` + `mt-auto` sur le détail : les textes explicatifs sont de longueur très
 * inégale ; sans cela les chiffres flottaient à des hauteurs différentes et la rangée ne se
 * lisait plus comme une rangée.
 */
function TuileKpi({
  label,
  valeur,
  detail,
  icone: Icone,
  accent = false,
  tendance,
  jauge,
  className,
}: {
  label: string;
  valeur: ReactNode;
  detail?: ReactNode;
  icone: typeof TrendingUp;
  accent?: boolean;
  /** Série mensuelle du même indicateur, sur la même période que le chiffre affiché. */
  tendance?: number[];
  /** Part remplie, en %, quand l'indicateur est un rapport de deux montants. */
  jauge?: { part: number; label: string };
  className?: string;
}) {
  const teinte = accent ? "var(--color-amber-fiscal)" : "var(--color-dv-serie-1)";

  return (
    <div
      className={cn(
        "animate-rise relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 pt-7 shadow-soft",
        className,
      )}
    >
      {/* Filet de tête : rattache la tuile à sa teinte sans colorer le chiffre lui-même. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${teinte}, transparent 85%)` }}
      />
      <p className="rule-label-lg mb-3 flex items-center gap-2 text-label-ink">
        <Icone className="size-3.5 shrink-0" style={{ color: teinte }} aria-hidden />
        {label}
      </p>
      <p
        className={cn("num text-[2.125rem] font-semibold leading-none", accent && "text-amber-fiscal")}
      >
        {valeur}
      </p>

      {tendance && tendance.length > 1 && (
        <Sparkline valeurs={tendance} hauteur={40} couleur={teinte} className="mt-4" />
      )}
      {jauge && (
        <div className="mt-5">
          <div
            className="h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--color-dv-track)" }}
            role="meter"
            aria-valuenow={Math.round(jauge.part)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Part ${jauge.label}`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, jauge.part))}%`,
                background: teinte,
                transition: "width 0.8s var(--ease-out-expo)",
              }}
            />
          </div>
          <p className="num mt-2 text-[0.8125rem] text-label-ink">
            {Math.round(jauge.part)} % {jauge.label}
          </p>
        </div>
      )}

      {detail && (
        <div className="mt-auto pt-4 text-[0.9375rem] leading-snug text-muted-foreground">
          {detail}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- Nature (anneau)

/**
 * « Quelle est ma nature d'activité » — la question qui décide du régime fiscal.
 *
 * En anneau plutôt qu'en barre empilée : à deux parts, l'angle donne la proportion
 * immédiatement, et le centre de l'anneau accueille le total, qui était sinon une ligne de
 * texte supplémentaire. La barre de 16 px, elle, obligeait à comparer deux longueurs posées
 * bout à bout — la comparaison la plus difficile qu'on puisse demander à un œil.
 */
function CarteNature({
  prestations,
  ventes,
  total,
  className,
}: {
  prestations: number;
  ventes: number;
  total: number;
  className?: string;
}) {
  const somme = prestations + ventes;
  if (somme <= 0) return null;

  const parts = [
    { label: "Prestations de services", valeur: prestations, couleur: "var(--color-dv-serie-1)" },
    { label: "Ventes de biens", valeur: ventes, couleur: "var(--color-dv-serie-2)" },
  ];

  return (
    <section
      className={cn(
        "animate-rise flex flex-col rounded-3xl border border-border bg-card p-6 shadow-soft",
        className,
      )}
    >
      <p className="rule-label-lg mb-5 text-label-ink">Nature de l&apos;activité</p>

      <div className="flex flex-1 items-center justify-center">
        <div className="relative grid place-items-center">
          <Donut parts={parts} taille={152} epaisseur={20} />
          {/* Le centre de l'anneau n'est pas un vide à décorer : il porte le total, qui n'a
              donc plus besoin de sa propre ligne de texte. */}
          <div className="absolute text-center">
            <p className="num text-xl font-semibold leading-none">{formatEuros(total)}</p>
            <p className="rule-label-lg mt-1.5 text-label-ink">HT</p>
          </div>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: p.couleur }}
            />
            <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-muted-foreground">
              {p.label}
            </span>
            <span className="num shrink-0 text-[0.9375rem] font-semibold">
              {Math.round((p.valeur / somme) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------- Évolution (aires/colonnes)

const VUES_EVOLUTION = [
  { id: "aires", label: "Aires", aide: "Lire la trajectoire du chiffre d'affaires" },
  { id: "colonnes", label: "Colonnes", aide: "Comparer deux mois précis" },
] as const;

type VueEvolution = (typeof VUES_EVOLUTION)[number]["id"];

/**
 * Le CA mensuel, avec le choix de la forme.
 *
 * Les deux figures ne répondent pas à la même question — l'aire dit une trajectoire, la
 * colonne permet de comparer deux mois nommés — et il n'y a pas de bonne réponse par défaut
 * valable pour tous les dossiers. On propose donc les deux au lieu d'arbitrer à la place de
 * l'utilisateur, l'aire en premier parce que « est-ce que ça monte » vient avant « combien
 * exactement en mars ».
 */
function CarteEvolution({ points }: { points: PointMensuel[] }) {
  const [vue, setVue] = useState<VueEvolution>("aires");

  /*
   * Une aire a besoin d'au moins deux points pour exister : entre un seul mois et lui-même il
   * n'y a aucune surface à remplir, et la carte serait vide. Le cas est loin d'être théorique
   * — période « Tout » sur un dossier dont la première facture est du mois en cours donne
   * exactement un point. On force alors les colonnes et on retire le sélecteur, plutôt que
   * d'offrir un choix dont une des deux options n'affiche rien.
   */
  const aireImpossible = points.length < 2;
  const vueEffective: VueEvolution = aireImpossible ? "colonnes" : vue;

  return (
    <CarteGraphe
      titre="Évolution du chiffre d'affaires"
      soustitre="Ventilé entre prestations de services et ventes de biens — la distinction qui décide de votre régime."
      index="01"
      actions={
        aireImpossible ? undefined : (
          <div
            className="flex shrink-0 rounded-full border border-border p-1"
            role="group"
            aria-label="Forme du graphique"
          >
            {VUES_EVOLUTION.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVue(v.id)}
                title={v.aide}
                aria-pressed={vue === v.id}
                className={cn(
                  "rule-label-lg rounded-full px-3 py-1.5 transition-colors",
                  vue === v.id
                    ? "bg-primary text-primary-foreground"
                    : "text-label-ink hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        )
      }
    >
      {vueEffective === "aires" ? (
        <AiresEmpilees points={points} />
      ) : (
        <ColonnesMensuelles points={points} />
      )}
    </CarteGraphe>
  );
}

// ------------------------------------------------------------------------ Cartes graphes

function CarteGraphe({
  titre,
  soustitre,
  index,
  actions,
  children,
}: {
  titre: string;
  soustitre?: string;
  index?: string;
  /** Contrôles propres à la figure (sélecteur de forme, bascule d'échelle…). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="animate-rise rounded-3xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {index && (
            /* Pastille ronde plutôt qu'une puce rectangulaire : le numéro d'ordre est un repère
               de navigation, pas une donnée — la forme le dit avant qu'on le lise. */
            <span className="num grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[0.8125rem] text-label-ink">
              {index}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-xl leading-tight sm:text-2xl">{titre}</h2>
            {soustitre && (
              <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                {soustitre}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const NIVEAU_SEUIL: Record<
  "ok" | "attention" | "serieux" | "critique",
  { label: string; badge: "success" | "warning" | "destructive" | "info" }
> = {
  ok: { label: "Sous le plafond", badge: "success" },
  attention: { label: "À surveiller", badge: "info" },
  serieux: { label: "Seuil proche", badge: "warning" },
  critique: { label: "Plafond dépassé", badge: "destructive" },
};

function CarteSeuil({
  seuil,
  regime,
}: {
  seuil: ReturnType<typeof etatSeuil>;
  regime?: string | null;
}) {
  const etat = NIVEAU_SEUIL[seuil.niveau];
  // Sans plafond connu, `pct` vaut 0 par convention : afficher « 0 % » laisserait croire à une
  // mesure. On montre un tiret et une piste en pointillés.
  const indetermine = seuil.provenance === "inconnu";
  const encre =
    seuil.niveau === "ok"
      ? "text-success-ink"
      : seuil.niveau === "attention"
        ? "text-info-ink"
        : seuil.niveau === "serieux"
          ? "text-warning-ink"
          : "text-destructive";

  return (
    <CarteGraphe
      titre="Position face au plafond de régime"
      soustitre={
        regime
          ? `Consommation du plafond de votre régime ${regime}.`
          : "Consommation du plafond de votre régime."
      }
      index="02"
    >
      {/* L'arc et les chiffres côte à côte : la figure n'est plus un accessoire posé sous une
          valeur, elle EST la valeur — le pourcentage vit au centre de l'anneau. */}
      <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-10">
        <JaugeArc
          pct={seuil.pct}
          niveau={seuil.niveau}
          indetermine={indetermine}
          taille={208}
          className="shrink-0"
        >
          <p
            className={cn(
              "font-display text-[3.25rem] font-semibold leading-none tracking-tight",
              indetermine ? "text-muted-foreground" : encre,
            )}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {indetermine ? "—" : <Chiffre to={seuil.pct} format={(n) => `${Math.round(n)}`} />}
          </p>
          <p className="rule-label-lg mt-2 text-label-ink">
            {indetermine ? "non mesurable" : "% du plafond"}
          </p>
        </JaugeArc>

        <div className="min-w-0 flex-1 space-y-4">
          {/* La sévérité ne repose jamais sur la seule couleur : un libellé l'accompagne. */}
          <Badge variant={indetermine ? "outline" : etat.badge}>
            <CircleAlert className="size-3.5" /> {indetermine ? "Non mesurable" : etat.label}
          </Badge>

          <dl className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2.5">
              <dt className="text-[0.9375rem] text-muted-foreground">Facturé sur la période</dt>
              <dd className="num text-lg font-semibold">{formatEuros(seuil.consomme)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[0.9375rem] text-muted-foreground">Plafond du régime</dt>
              <dd className="num text-lg font-semibold">
                {seuil.plafond != null ? (
                  formatEuros(seuil.plafond)
                ) : (
                  <span className="text-muted-foreground">inconnu</span>
                )}
              </dd>
            </div>
          </dl>

          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{seuil.message}</p>
          <p className="rule-label-lg text-label-ink">
            Source :{" "}
            {seuil.provenance === "rapport"
              ? "rapport d'activité"
              : seuil.provenance === "factures"
                ? "estimation depuis vos factures"
                : "plafond inconnu"}
          </p>
        </div>
      </div>
    </CarteGraphe>
  );
}

function SignauxConformite({ rapport }: { rapport: RapportActivite }) {
  if (rapport.signaux_conformite.length === 0) return null;
  return (
    <section className="animate-rise rounded-3xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl">Signaux de conformité</h2>
        <Badge variant="outline">
          {rapport.date_debut} → {rapport.date_fin}
        </Badge>
      </div>
      <ul className="space-y-3">
        {rapport.signaux_conformite.map((s, i) => (
          <li
            key={i}
            className="rounded-xl border border-amber-fiscal/30 border-l-4 border-l-amber-fiscal bg-amber-fiscal/8 p-4"
          >
            <p className="flex items-start gap-2.5 text-[1.0625rem] font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
              {s.label}
            </p>
            <p className="mt-1.5 pl-6.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {s.question}
            </p>
          </li>
        ))}
      </ul>
      {rapport.sources.length > 0 && (
        <p className="rule-label-lg mt-5 text-label-ink">Sources : {rapport.sources.join(", ")}</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Alertes de conformité

/**
 * Rendu des alertes par SÉVÉRITÉ, chacune dans sa propre carte.
 *
 * L'ancienne forme — un badge « critical » posé à gauche d'un paragraphe gris — traitait un
 * blocage fiscal comme une ligne de liste : la mention la plus grave de l'écran était aussi
 * la moins visible. Ici la sévérité est portée par la surface entière (fond teinté, filet
 * gauche épais, icône), et le message passe en couleur de texte pleine.
 */
const NIVEAU_ALERTE = {
  critical: {
    label: "Action requise",
    icone: ShieldAlert,
    carte: "border-destructive/30 border-l-destructive bg-destructive/8",
    ink: "text-destructive",
  },
  warning: {
    label: "À surveiller",
    icone: TriangleAlert,
    carte: "border-warning/40 border-l-warning bg-warning/10",
    ink: "text-warning-ink",
  },
  info: {
    label: "Pour information",
    icone: Info,
    carte: "border-info/30 border-l-info bg-info/8",
    ink: "text-info-ink",
  },
} as const;

function AlertesConformite({ alertes }: { alertes: ComplianceAlert[] }) {
  // Le plus grave d'abord : sur un cockpit, l'ordre de lecture EST une hiérarchie.
  const rang = { critical: 0, warning: 1, info: 2 } as const;
  const triees = [...alertes].sort((a, b) => rang[a.severity] - rang[b.severity]);

  return (
    <section className="animate-rise rounded-3xl border border-border bg-card p-6 shadow-soft">
      <h2 className="text-xl sm:text-2xl">Alertes de conformité</h2>
      <ul className="mt-5 space-y-3">
        {triees.map((a, i) => {
          const n = NIVEAU_ALERTE[a.severity] ?? NIVEAU_ALERTE.info;
          const Icone = n.icone;
          return (
            <li key={i} className={cn("rounded-xl border border-l-4 p-4", n.carte)}>
              <p className={cn("rule-label-lg flex items-center gap-2", n.ink)}>
                <Icone className="size-4 shrink-0" aria-hidden />
                {n.label}
              </p>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-foreground">{a.message}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------- Colonne de droite

/** Anneau de progression : la même valeur que le score, lisible sans lire le chiffre. */
function AnneauProgression({ score, couleur }: { score: number; couleur: string }) {
  const R = 26;
  const circonference = 2 * Math.PI * R;
  const remplissage = (Math.min(100, Math.max(0, score)) / 100) * circonference;

  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <circle cx={32} cy={32} r={R} fill="none" stroke="var(--color-dv-track)" strokeWidth={6} />
      <circle
        cx={32}
        cy={32}
        r={R}
        fill="none"
        stroke={couleur}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={`${remplissage} ${circonference}`}
        /* On démarre à midi : un anneau qui commence à 3 h se lit comme une jauge décentrée. */
        transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dasharray 0.9s var(--ease-out-expo)" }}
      />
    </svg>
  );
}

function CarteSante({ sante }: { sante: ReturnType<typeof indiceSante> }) {
  const encre =
    sante.niveau === "ok"
      ? "text-success-ink"
      : sante.niveau === "attention"
        ? "text-warning-ink"
        : "text-destructive";
  const trait =
    sante.niveau === "ok"
      ? "var(--color-success)"
      : sante.niveau === "attention"
        ? "var(--color-warning)"
        : "var(--color-destructive)";

  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl">Avancement du dossier</h2>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            <span className={cn("num font-semibold", encre)}>{Math.round(sante.score)}</span> sur 100
          </p>
        </div>
        <div className="relative grid shrink-0 place-items-center">
          <AnneauProgression score={sante.score} couleur={trait} />
          <span className={cn("num absolute text-base font-semibold", encre)}>
            <Chiffre to={sante.score} format={(n) => `${Math.round(n)}`} />
          </span>
        </div>
      </div>
      <ul className="space-y-3.5">
        {sante.criteres.map((c) => (
          <li key={c.label} className="flex items-start gap-3">
            {/* Coche pleine contre anneau vide : la différence se voit avant la couleur — le
                gris et le vert de l'ancienne puce de 6 px étaient quasi indiscernables. */}
            {c.acquis ? (
              <span
                aria-hidden
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success text-success-foreground"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
            ) : (
              <span
                aria-hidden
                className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40"
              />
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[0.9375rem]",
                  c.acquis ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {c.label}
                <span className="sr-only">{c.acquis ? " : fait" : " : à faire"}</span>
              </p>
              <p className="text-[0.8125rem] text-muted-foreground">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CarteDeclaration({ declaration }: { declaration: Declaration }) {
  const statutLabel =
    declaration.statut === "brouillon"
      ? "Brouillon — à relire"
      : declaration.statut === "revue"
        ? "Relue par vos soins"
        : "Prête pour signature";

  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl">Dernière déclaration</h2>
        <Badge variant={declaration.statut === "brouillon" ? "warning" : "success"}>
          {statutLabel}
        </Badge>
      </div>
      <p className="text-[0.9375rem] text-muted-foreground">
        {declaration.formulaire} · {declaration.regime}
      </p>
      <p className="num mt-4 text-[1.75rem] font-semibold leading-none">
        {formatEuros(declaration.total_ca_declare)}
      </p>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">
        déclarés sur {declaration.date_debut} → {declaration.date_fin}
      </p>
      <Button asChild variant="outline" className="mt-5 w-full rounded-full">
        <Link to="/activite">
          Ouvrir la déclaration <ArrowRight className="size-4" />
        </Link>
      </Button>
    </section>
  );
}

// -------------------------------------------------------------------------- Squelettes

/**
 * Attente du reçu fiscal.
 *
 * Aux dimensions RÉELLES du document (320 px de large, ~620 px de haut) : un simple
 * « Chargement… » centré faisait sauter toute la colonne de droite au moment où le reçu
 * arrivait, et la page se réorganisait sous le curseur.
 */
function SqueletteRecu() {
  return (
    <div aria-busy className="space-y-6">
      <span className="sr-only">Chargement de votre reçu fiscal…</span>
      <div className="mx-auto h-3 w-40 animate-pulse rounded-full bg-secondary" />
      <div className="mx-auto h-155 w-80 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  );
}

// -------------------------------------------------------------------------- État vide

/**
 * Rien à consolider encore : plutôt qu'un cockpit vide, on montre ce que l'écran
 * deviendra et l'action unique qui l'alimente.
 */
function EtatVide({
  chargement,
  isSirenVerified,
  profile,
  diag,
  calcul,
}: {
  chargement: boolean;
  isSirenVerified: boolean;
  profile: UserProfile | null;
  diag: DiagnosticProfile | null;
  calcul: Calcul;
}) {
  if (chargement) {
    // Squelette calqué sur le bento réel — pavé 8/4, puis les quatre tuiles, puis le bloc de
    // graphe : ce qui arrive se pose à l'endroit qui l'attendait, sans décalage.
    return (
      <div className="space-y-8" aria-busy>
        <span className="sr-only">Chargement de vos indicateurs…</span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <div className="h-64 animate-pulse rounded-3xl border border-border bg-card sm:col-span-12 lg:col-span-8" />
          <div className="h-64 animate-pulse rounded-3xl border border-border bg-card sm:col-span-12 lg:col-span-4" />
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-border bg-card sm:col-span-6"
              style={{ animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
        <div className="h-104 animate-pulse rounded-3xl border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="animate-rise relative overflow-hidden rounded-2xl border border-dashed border-border bg-card p-8">
        <div className="shimmer-premium pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="rule-label-lg mb-4 text-accent-ink">
            <span className="mr-2 inline-block h-px w-6 -translate-y-0.75 bg-accent align-middle" />
            Analyse financière
          </p>
          <h2 className="text-2xl leading-tight sm:text-3xl">
            Vos indicateurs s&apos;allument{" "}
            <span className="italic font-normal">à la première facture.</span>
          </h2>
          <p className="mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-muted-foreground">
            Chiffre d&apos;affaires mensuel, ventilation prestations / ventes, position face au
            plafond de votre régime, concentration client et cotisations estimées : tout se
            calcule automatiquement à partir des factures émises depuis l&apos;espace
            Facturation.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant={isSirenVerified ? "accent" : "outline"} className="rounded-full">
              <Link to={isSirenVerified ? "/activite" : "/onboarding/verification"}>
                {isSirenVerified ? (
                  <>
                    <Receipt className="size-4" /> Émettre ma première facture
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" /> Vérifier mon SIREN
                  </>
                )}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* En attendant, on garde les repères déjà connus du profil déclaré. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Provision estimée (trim.)"
          value={`${formatMoney(calcul.provision_conseillee)} €`}
          accent
        />
        <Stat
          label="Revenu mensuel déclaré"
          value={
            profile?.estimated_monthly_revenue ?? (profile ? formatCaLabel(diag, profile) : "—")
          }
          mono={false}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- Stat

function Stat({
  label,
  value,
  accent = false,
  mono = true,
  locked = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
  /** Fonctionnalité pas encore déverrouillée (SIREN non vérifié) : affichée en grisé, sans erreur. */
  locked?: boolean;
}) {
  return (
    /* Pas de `card-hover` ici : cette carte n'est pas cliquable. Une élévation au survol sur
       une surface inerte promet une interaction qui n'existe pas. */
    <div
      className={cn(
        "animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft",
        locked && "opacity-60",
      )}
    >
      <p className="rule-label-lg mb-3 flex items-center gap-2 text-label-ink">
        {label}
        {locked && (
          <Lock className="size-3.5 shrink-0">
            <title>Déverrouillé après vérification SIREN</title>
          </Lock>
        )}
      </p>
      <p
        className={cn(
          "text-2xl font-semibold leading-tight",
          mono && "num",
          accent && "text-amber-fiscal",
        )}
      >
        {value}
      </p>
    </div>
  );
}
