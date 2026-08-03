import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FiscalReceipt } from "@/components/lm/FiscalReceipt";
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
      { title: "Dashboard — LedgerMind" },
      { name: "description", content: "Votre situation fiscale, en un coup d'œil." },
      { property: "og:title", content: "Dashboard — LedgerMind" },
      { property: "og:description", content: "Votre situation fiscale, en un coup d'œil." },
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
      profile.tax_category_reason ??
      "Votre profil fiscal a été qualifié par LedgerMind.",
  };
}

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

function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            me.agent_context.guidance.last_session_id ||
            me.agent_context.intake.last_session_id;
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

  const profile = detail?.profile ?? null;
  const diag = detail?.diagnostic_profile ?? null;
  const branch = detail?.branch ?? null;
  const isGuidance = branch === "guidance";
  const greeting = displayFirstName(user);

  const hasPlan = (profile?.recommended_actions.length ?? 0) > 0 || Boolean(profile?.recommended_regime);
  const statusLabel = hasPlan || profile?.tax_category ? "à jour" : "en cours";

  // Les fonctionnalités complètes du dashboard (reçu fiscal, catégorie précise, alertes de
  // conformité) dépendent de la vérification SIREN — branche A. Un profil issu de la seule
  // guidance porte "skipped" : le diagnostic est fait, mais rien n'est encore vérifié.
  const isSirenVerified = profile?.verification_status === "verified";
  const isGuidanceOnly = isGuidance && profile?.verification_status !== "verified";

  const data = {
    qualification: profileToQualification(profile ?? emptyReceiptProfile()),
    calcul: profileToCalcul(profile ?? emptyReceiptProfile()),
  };

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
        { l: "Conformité", done: !!profile?.tax_category },
        { l: "Rapport", done: !!profile?.tax_category },
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

      {/* Un diagnostic sans SIREN vérifié débloque déjà la progression et la feuille de route,
          mais pas le reçu fiscal ni les alertes de conformité, qui dépendent de la branche A
          (vérification SIREN/avis de situation). On l'explique plutôt que de laisser des
          cartes vides sans raison apparente. */}
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

      <div className="grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Stat
              label="Catégorie fiscale"
              value={profile?.tax_category ?? profile?.recommended_regime ?? "—"}
            />
            <Stat
              label="Provision estimée (trim.)"
              value={`${formatMoney(data.calcul.provision_conseillee)} €`}
              accent
            />
            <Stat
              label="Revenu mensuel déclaré"
              value={
                profile?.estimated_monthly_revenue ??
                (profile ? formatCaLabel(diag, profile) : "—")
              }
              mono={false}
            />
            <Stat
              label="Code APE"
              value={isSirenVerified ? (profile?.ape_code ?? "Non renseigné") : "Verrouillé"}
              mono={false}
              locked={!isSirenVerified}
            />
          </div>

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

        <div className="animate-rise lg:sticky lg:top-24 lg:col-span-5">
          {loading ? (
            <div className="rule-label text-center text-muted-foreground">Chargement…</div>
          ) : isSirenVerified ? (
            <>
              <p className="rule-label mb-6 text-center text-accent-ink">
                Dernier reçu fiscal
              </p>
              <FiscalReceipt qualification={data.qualification} calcul={data.calcul} />
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
        </div>
      </div>
    </AppShell>
  );
}

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
