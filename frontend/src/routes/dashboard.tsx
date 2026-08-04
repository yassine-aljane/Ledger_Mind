import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  FileText,
  Lock,
  Minus,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FiscalReceipt } from "@/components/lm/FiscalReceipt";
import {
  BarresClassement,
  ColonnesMensuelles,
  JaugeSeuil,
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
  return {
    reference: facture.numero,
    client: facture.client?.nom ?? "Client",
    date: new Date(facture.date_emission).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
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
          // Une session issue de la seule guidance (pas encore de SIREN vérifié) n'existe pas
          // côté orchestrateur : ce n'est pas une erreur pour l'utilisateur, juste un dossier
          // partiel. On retombe sur le résultat mis en cache par l'écran de diagnostic.
          const cached = loadCachedDiagnosticResult();
          if (!cancelled) {
            setDetail(cached);
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

  const aDesDonnees = factures.length > 0;

  // La facture la plus récente pilote le reçu ; sinon on retombe sur l'estimation profil.
  const derniereFacture = useMemo(() => {
    if (factures.length === 0) return null;
    return [...factures].sort(
      (a, b) => new Date(b.date_emission).getTime() - new Date(a.date_emission).getTime(),
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
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to="/activite">
                <Receipt className="size-3.5" /> Espace Facturation
              </Link>
            </Button>
          ) : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="mb-8 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {!loading && !detail && !error && (
        <div className="mb-10 space-y-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Aucune session trouvée pour votre compte.</p>
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
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
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

      <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="space-y-6 lg:col-span-7">
          {aDesDonnees ? (
            <>
              <HeroFinancier synthese={synthese} periode={periode} />
              <RangeeKpi synthese={synthese} rapport={dernierRapport} />
              <CarteGraphe
                titre="Chiffre d'affaires par mois"
                soustitre="Ventilé entre prestations de services et ventes de biens — la distinction qui décide de votre régime."
                index="01"
              >
                <ColonnesMensuelles points={synthese.points} />
              </CarteGraphe>
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
            <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
              <h2 className="text-lg">Alertes de conformité</h2>
              <ul className="mt-4 space-y-3">
                {profile.compliance_alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Badge
                      variant={
                        a.severity === "critical"
                          ? "destructive"
                          : a.severity === "warning"
                            ? "warning"
                            : "info"
                      }
                      className="mt-0.5 shrink-0"
                    >
                      {a.severity}
                    </Badge>
                    <span className="leading-relaxed">{a.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
            <div className="mb-6 flex items-center justify-between gap-3">
              <h2 className="text-lg">Pipeline de traitement</h2>
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
            <div className="grid grid-cols-4 gap-3">
              {pipeline.map((p) => (
                <div key={p.l} className="space-y-2">
                  <div
                    className={cn(
                      "h-1.5 rounded-full transition-colors",
                      p.done ? "bg-success" : "bg-border",
                    )}
                  />
                  <span className="rule-label block text-muted-foreground">{p.l}</span>
                </div>
              ))}
            </div>
          </section>

          {profile && profile.recommended_actions.length > 0 && (
            <section className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <div className="flex items-center justify-between gap-3 border-b border-border p-5">
                <h2 className="text-lg">Prochaines actions</h2>
                {isGuidance && (
                  <Link
                    to="/parametres"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Voir le profil <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
              <ul className="divide-y divide-border">
                {profile.recommended_actions.slice(0, 6).map((item) => (
                  <li
                    key={item.step}
                    className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-secondary/40"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="num shrink-0 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground">
                        {item.step.toString().padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        {item.description ? (
                          <p className="truncate text-sm text-muted-foreground">
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
        <div className="animate-rise space-y-6 lg:sticky lg:top-24 lg:col-span-5">
          {loading ? (
            <div className="rule-label text-center text-muted-foreground">Chargement…</div>
          ) : isSirenVerified ? (
            <>
              <p className="rule-label mb-6 text-center text-accent-ink">
                {derniereFacture ? "Dernière facture émise" : "Reçu fiscal — projection"}
              </p>
              <FiscalReceipt qualification={qualification} calcul={calcul} />
              {derniereFacture && (
                <p className="text-center text-xs text-muted-foreground">
                  Lecture fiscale de la facture {derniereFacture.numero}.{" "}
                  <Link to="/activite" className="text-primary hover:underline">
                    Voir toutes les factures
                  </Link>
                </p>
              )}
            </>
          ) : (
            <div className="space-y-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <p className="rule-label text-muted-foreground">Reçu fiscal — verrouillé</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
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
          {declarations.length > 0 && <CarteDeclaration declaration={declarations[0]} />}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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
              "rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-200 active:scale-[0.97]",
              valeur === p.id
                ? "bg-primary text-primary-foreground shadow-soft"
                : "border border-border text-muted-foreground hover:border-ink hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
          <span className="relative inline-flex size-2 rounded-full bg-success-ink" />
        </span>
        <span className="num">{synthese.nb_factures}</span> facture
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

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" /> pas d&apos;historique comparable
      </span>
    );
  }
  const positif = pct > 0;
  const neutre = Math.abs(pct) < 0.5;
  const Icone = neutre ? Minus : positif ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        neutre ? "text-muted-foreground" : positif ? "text-success-ink" : "text-destructive",
      )}
    >
      <Icone className="size-3" />
      <span className="num">{formatPct(pct)}</span>
      <span className="font-normal text-muted-foreground">vs période précédente</span>
    </span>
  );
}

// ------------------------------------------------------------------------------ Hero

/** Le chiffre que l'écran porte — un seul par vue, en sans, gros, non tabulaire. */
function HeroFinancier({ synthese, periode }: { synthese: SyntheseFinanciere; periode: Periode }) {
  const libelle = PERIODES.find((p) => p.id === periode)?.label ?? "";
  return (
    <section className="animate-rise relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-soft">
      <div
        className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "var(--gradient-safran)" }}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="rule-label mb-3 text-muted-foreground">
            <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
            Chiffre d&apos;affaires HT · {libelle}
          </p>
          <p className="font-sans text-[clamp(2.5rem,7vw,3.5rem)] font-semibold leading-none tracking-tight">
            <Chiffre to={synthese.total_ht} format={(n) => formatEuros(n)} />
          </p>
          <div className="mt-3">
            <Delta pct={synthese.delta_ht_pct} />
          </div>
        </div>
        <div className="w-full max-w-[13rem]">
          <p className="rule-label mb-2 text-right text-muted-foreground">Tendance mensuelle</p>
          <Sparkline valeurs={synthese.points.map((p) => p.total_ht)} />
          {synthese.meilleur_mois && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Meilleur mois : {synthese.meilleur_mois.labelLong} ·{" "}
              <span className="num">{formatEuros(synthese.meilleur_mois.total_ht)}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------- Tuiles KPI

function TuileKpi({
  label,
  valeur,
  detail,
  icone: Icone,
  accent = false,
}: {
  label: string;
  valeur: ReactNode;
  detail?: ReactNode;
  icone: typeof TrendingUp;
  accent?: boolean;
}) {
  return (
    <div className="card-hover animate-rise rounded-2xl border border-border bg-card p-5 shadow-soft">
      <p className="rule-label mb-3 flex items-center gap-1.5 text-muted-foreground">
        <Icone className="size-3 text-accent" aria-hidden />
        {label}
      </p>
      <p className={cn("num text-xl", accent && "font-medium text-amber-fiscal")}>{valeur}</p>
      {detail && <div className="mt-2 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function RangeeKpi({
  synthese,
  rapport,
}: {
  synthese: SyntheseFinanciere;
  rapport: RapportActivite | null;
}) {
  const partPrestations =
    synthese.total_ht > 0 ? (synthese.prestations_ht / synthese.total_ht) * 100 : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TuileKpi
        label="Factures émises"
        icone={FileText}
        valeur={<Chiffre to={synthese.nb_factures} format={(n) => Math.round(n).toString()} />}
        detail={<Delta pct={synthese.delta_factures_pct} />}
      />
      <TuileKpi
        label="Panier moyen HT"
        icone={Activity}
        valeur={<Chiffre to={synthese.panier_moyen} format={formatEuros} />}
        detail={`Sur ${synthese.nb_factures} facture${synthese.nb_factures > 1 ? "s" : ""}`}
      />
      <TuileKpi
        label="TVA collectée"
        icone={Receipt}
        valeur={<Chiffre to={synthese.total_tva} format={formatEuros} />}
        detail={
          synthese.total_tva === 0
            ? "Aucune TVA facturée — franchise en base probable"
            : "À reverser lors de votre prochaine déclaration"
        }
      />
      <TuileKpi
        label={rapport ? "Cotisations estimées" : "Provision conseillée"}
        icone={Sparkles}
        accent
        valeur={
          <Chiffre
            to={rapport ? rapport.cotisations_estimees : synthese.total_ht * 0.22}
            format={formatEuros}
          />
        }
        detail={
          rapport
            ? "Calculé par votre dernier rapport d'activité"
            : "Estimation à 22 % — générez un rapport pour affiner"
        }
      />
      <div className="sm:col-span-2">
        <RepartitionActivite
          prestations={synthese.prestations_ht}
          ventes={synthese.ventes_ht}
          partPrestations={partPrestations}
        />
      </div>
    </div>
  );
}

/** Part-à-tout sur une seule barre : la lecture « quelle est ma nature d'activité ». */
function RepartitionActivite({
  prestations,
  ventes,
  partPrestations,
}: {
  prestations: number;
  ventes: number;
  partPrestations: number;
}) {
  const total = prestations + ventes;
  if (total <= 0) return null;
  const partVentes = 100 - partPrestations;

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-5 shadow-soft">
      <p className="rule-label mb-4 text-muted-foreground">Nature de l&apos;activité</p>
      {/* Deux aplats séparés par 2 px de fond — jamais un contour autour des segments. */}
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {partPrestations > 0 && (
          <div
            className="h-full rounded-l-full"
            style={{
              width: `${partPrestations}%`,
              background: "var(--color-dv-serie-1)",
              transition: "width 0.8s var(--ease-out-expo)",
            }}
          />
        )}
        {partVentes > 0 && (
          <div
            className="h-full rounded-r-full"
            style={{
              width: `${partVentes}%`,
              background: "var(--color-dv-serie-2)",
              transition: "width 0.8s var(--ease-out-expo)",
            }}
          />
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[3px]"
            style={{ background: "var(--color-dv-serie-1)" }}
          />
          <div>
            <p className="text-xs text-muted-foreground">Prestations de services</p>
            <p className="num text-sm font-medium">
              {formatEuros(prestations)}{" "}
              <span className="font-normal text-muted-foreground">
                · {Math.round(partPrestations)} %
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[3px]"
            style={{ background: "var(--color-dv-serie-2)" }}
          />
          <div>
            <p className="text-xs text-muted-foreground">Ventes de biens</p>
            <p className="num text-sm font-medium">
              {formatEuros(ventes)}{" "}
              <span className="font-normal text-muted-foreground">
                · {Math.round(partVentes)} %
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ Cartes graphes

function CarteGraphe({
  titre,
  soustitre,
  index,
  children,
}: {
  titre: string;
  soustitre?: string;
  index?: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-5 flex items-start gap-4">
        {index && (
          <span className="num mt-0.5 shrink-0 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground">
            {index}
          </span>
        )}
        <div>
          <h2 className="text-lg leading-tight">{titre}</h2>
          {soustitre && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{soustitre}</p>
          )}
        </div>
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
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-sans text-3xl font-semibold leading-none">
          <Chiffre to={seuil.pct} format={(n) => `${Math.round(n)} %`} />
        </p>
        {/* La sévérité ne repose jamais sur la seule couleur : un libellé l'accompagne. */}
        <Badge variant={etat.badge}>
          <CircleAlert className="size-3" /> {etat.label}
        </Badge>
      </div>
      <JaugeSeuil pct={seuil.pct} niveau={seuil.niveau} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="num">{formatEuros(seuil.consomme)} facturés</span>
        {seuil.plafond != null && <span className="num">Plafond {formatEuros(seuil.plafond)}</span>}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{seuil.message}</p>
      <p className="rule-label mt-3 text-muted-foreground/70">
        Source :{" "}
        {seuil.provenance === "rapport"
          ? "rapport d'activité"
          : seuil.provenance === "factures"
            ? "estimation depuis vos factures"
            : "plafond inconnu"}
      </p>
    </CarteGraphe>
  );
}

function SignauxConformite({ rapport }: { rapport: RapportActivite }) {
  if (rapport.signaux_conformite.length === 0) return null;
  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg">Signaux de conformité</h2>
        <Badge variant="outline">
          {rapport.date_debut} → {rapport.date_fin}
        </Badge>
      </div>
      <ul className="space-y-3">
        {rapport.signaux_conformite.map((s, i) => (
          <li
            key={i}
            className="rounded-xl border border-amber-fiscal/30 bg-amber-fiscal/8 p-4 text-sm"
          >
            <p className="font-medium">{s.label}</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">{s.question}</p>
          </li>
        ))}
      </ul>
      {rapport.sources.length > 0 && (
        <p className="rule-label mt-4 text-muted-foreground/70">
          Sources : {rapport.sources.join(", ")}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- Colonne de droite

function CarteSante({ sante }: { sante: ReturnType<typeof indiceSante> }) {
  const couleur =
    sante.niveau === "ok"
      ? "text-success-ink"
      : sante.niveau === "attention"
        ? "text-warning-ink"
        : "text-destructive";

  return (
    <section className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg">Avancement du dossier</h2>
        <p className={cn("num text-2xl font-medium", couleur)}>
          <Chiffre to={sante.score} format={(n) => `${Math.round(n)}`} />
          <span className="text-sm text-muted-foreground"> / 100</span>
        </p>
      </div>
      <ul className="space-y-2.5">
        {sante.criteres.map((c) => (
          <li key={c.label} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                c.acquis ? "bg-success" : "bg-border",
              )}
            />
            <div className="min-w-0">
              <p className={cn(c.acquis ? "text-foreground" : "text-muted-foreground")}>
                {c.label}
                <span className="sr-only">{c.acquis ? " : fait" : " : à faire"}</span>
              </p>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg">Dernière déclaration</h2>
        <Badge variant={declaration.statut === "brouillon" ? "warning" : "success"}>
          {statutLabel}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {declaration.formulaire} · {declaration.regime}
      </p>
      <p className="num mt-3 text-2xl">{formatEuros(declaration.total_ca_declare)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        déclarés sur {declaration.date_debut} → {declaration.date_fin}
      </p>
      <Button asChild variant="outline" size="sm" className="mt-4 w-full rounded-full">
        <Link to="/activite">
          Ouvrir la déclaration <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </section>
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
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-border bg-card"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="animate-rise relative overflow-hidden rounded-2xl border border-dashed border-border bg-card p-8">
        <div className="shimmer-premium pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="rule-label mb-3 text-accent-ink">
            <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
            Analyse financière
          </p>
          <h2 className="text-2xl leading-tight">
            Vos indicateurs s&apos;allument{" "}
            <span className="italic font-normal">à la première facture.</span>
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
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
    <div
      className={cn(
        "card-hover animate-rise rounded-2xl border border-border bg-card p-5 shadow-soft",
        locked && "opacity-60",
      )}
    >
      <p className="rule-label mb-3 flex items-center gap-1.5 text-muted-foreground">
        {label}
        {locked && (
          <Lock className="size-3 text-muted-foreground">
            <title>Déverrouillé après vérification SIREN</title>
          </Lock>
        )}
      </p>
      <p className={cn("text-xl", mono && "num", accent && "font-medium text-amber-fiscal")}>
        {value}
      </p>
    </div>
  );
}
