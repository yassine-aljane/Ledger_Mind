import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { Badge, ButtonLink, Card, ErrorBlock, LoadingBlock } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadSession, saveSession } from "@/lib/session-store";
import { DEMO_ROADMAP } from "@/lib/demo";
import { RoadmapView } from "@/components/roadmap-view";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — LedgerMind" },
      {
        name: "description",
        content: "Votre situation fiscale, en un coup d'œil — reçu de qualification et prochaines actions.",
      },
      { property: "og:title", content: "Tableau de bord — LedgerMind" },
      { property: "og:description", content: "Votre situation fiscale en un coup d'œil." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="dashboard"
      title="Votre tableau de bord"
      pitch="Tout votre parcours réuni : statut, régime recommandé, documents et prochaines actions."
      benefits={[
        "Avancement du parcours en temps réel",
        "Régime recommandé toujours visible",
        "Raccourcis vers capture, cabinets et feuille de route",
      ]}
      preview={<RoadmapView roadmap={DEMO_ROADMAP} />}
    >
      <Dashboard />
    </PremiumGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Types locaux (reçus fiscal — même logique que l'ancien front)              */
/* -------------------------------------------------------------------------- */

type Qualification = {
  categorie: string;
  imposable: boolean;
  tva_applicable: boolean;
  taux_tva: number;
  retenue_source_applicable: boolean;
  taux_rs: number;
  base_legale: string;
  explication_simple: string;
};

type Calcul = {
  reference: string;
  client: string;
  date: string;
  montant_ht: number;
  tva: number;
  retenue_source: number;
  css: number;
  net_a_percevoir: number;
  provision_conseillee: number;
};

type ProfileLike = Record<string, unknown>;

function formatMoney(n: number) {
  return Math.round(n).toLocaleString("fr-FR");
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function profileToQualification(profile: ProfileLike): Qualification {
  const tax = asString(profile.tax_category);
  const isBnc = tax === "BNC" || tax === "mixed";
  const international = asBool(profile.international_clients) === true;
  return {
    categorie: asString(profile.recommended_regime) ?? tax ?? "Non classifié",
    imposable: true,
    tva_applicable: international,
    taux_tva: international ? 0.2 : 0,
    retenue_source_applicable: isBnc && asBool(profile.has_recurring_contracts) === true,
    taux_rs: isBnc ? 0.1 : 0,
    base_legale: tax === "BNC" ? "Art. 93 CGI — BNC" : "Art. 38 CGI — BIC",
    explication_simple:
      asString(profile.tax_category_reason) ??
      "Votre profil fiscal a été qualifié par LedgerMind.",
  };
}

function profileToCalcul(profile: ProfileLike): Calcul {
  const monthlyStr = asString(profile.estimated_monthly_revenue) ?? "0";
  const digits = monthlyStr.replace(/[^\d]/g, "");
  const annualDigits = (asString(profile.estimated_annual_revenue) ?? "").replace(/[^\d]/g, "");
  const monthly = digits
    ? parseInt(digits, 10)
    : annualDigits
      ? Math.round(parseInt(annualDigits, 10) / 12)
      : 2500;
  const ht = monthly * 3;
  const tva = asBool(profile.international_clients) ? ht * 0.2 : 0;
  const rs = asString(profile.tax_category) === "BNC" ? ht * 0.1 : 0;
  const activities = asList(profile.activity_types);
  return {
    reference: `LM-${asString(profile.siren) ?? "NEW"}-${new Date().getFullYear()}`,
    client: asString(profile.denomination) ?? activities[0] ?? "Votre activité",
    date: new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    montant_ht: ht,
    tva,
    retenue_source: rs,
    css: ht * 0.01,
    net_a_percevoir: ht + tva - rs - ht * 0.01,
    provision_conseillee: Math.round(ht * 0.22),
  };
}

function formatCaLabel(diag: ProfileLike | null, profile: ProfileLike): string {
  const ca = diag?.ca_estime_annuel;
  if (typeof ca === "number") {
    return `≈ ${Math.round(ca).toLocaleString("fr-FR")} € / an`;
  }
  if (asString(profile.estimated_annual_revenue)) return asString(profile.estimated_annual_revenue)!;
  if (asString(profile.estimated_monthly_revenue)) {
    return `${asString(profile.estimated_monthly_revenue)} / mois`;
  }
  return "—";
}

/* -------------------------------------------------------------------------- */
/* Reçu fiscal (design ancien front, tokens LedgerMind)                       */
/* -------------------------------------------------------------------------- */

function FiscalReceipt({
  qualification,
  calcul,
}: {
  qualification: Qualification;
  calcul: Calcul;
}) {
  return (
    <div className="relative group [perspective:1200px]">
      <div
        className="pointer-events-none absolute inset-0 translate-y-8 scale-90 bg-foreground/15 opacity-40 blur-3xl"
        aria-hidden
      />
      <div className="relative mx-auto w-80 bg-card shadow-[0_20px_60px_-15px_oklch(0.22_0.04_160_/_0.28)] ring-1 ring-foreground/5 transition-transform duration-500 hover:-translate-y-1">
        {/* perforation haut */}
        <div
          className="h-4 w-full"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, transparent 6px, var(--card) 6.5px)",
            backgroundSize: "16px 12px",
            backgroundPosition: "center top",
            backgroundRepeat: "repeat-x",
          }}
          aria-hidden
        />

        <div className="px-8 pb-8 pt-2 font-mono text-[11px] text-foreground">
          <div className="mb-6 space-y-1 text-center">
            <p className="text-sm font-bold tracking-tighter">LEDGERMIND FISCAL</p>
            <p className="opacity-50">REÇU DE QUALIFICATION</p>
            <p className="opacity-50">#{calcul.reference}</p>
            <p className="opacity-50">
              {calcul.date} — {calcul.client}
            </p>
          </div>

          <div
            className="my-4 h-px"
            style={{
              backgroundImage:
                "linear-gradient(to right, color-mix(in oklab, var(--foreground) 25%, transparent) 50%, transparent 50%)",
              backgroundSize: "8px 1px",
              backgroundRepeat: "repeat-x",
            }}
          />

          <p className="mb-3 text-[10px] uppercase tracking-widest opacity-40">Base</p>
          <div className="mb-3 flex justify-between">
            <span>MONTANT HT</span>
            <span className="font-medium">{formatMoney(calcul.montant_ht)}</span>
          </div>

          <div
            className="my-4 h-px"
            style={{
              backgroundImage:
                "linear-gradient(to right, color-mix(in oklab, var(--foreground) 25%, transparent) 50%, transparent 50%)",
              backgroundSize: "8px 1px",
              backgroundRepeat: "repeat-x",
            }}
          />

          <p className="mb-3 text-[10px] uppercase tracking-widest opacity-40">Postes fiscaux</p>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between">
                <span>TVA ({(qualification.taux_tva * 100).toFixed(0)}%)</span>
                <span className="text-accent-foreground">+ {formatMoney(calcul.tva)}</span>
              </div>
              <p className="mt-0.5 text-[9px] italic opacity-40">{qualification.base_legale}</p>
            </div>
            <div>
              <div className="flex justify-between">
                <span>RETENUE SOURCE ({(qualification.taux_rs * 100).toFixed(0)}%)</span>
                <span className="text-accent-foreground">− {formatMoney(calcul.retenue_source)}</span>
              </div>
              <p className="mt-0.5 text-[9px] italic opacity-40">Prélevée par le client</p>
            </div>
            <div className="flex justify-between">
              <span>CSS</span>
              <span className="text-accent-foreground">− {formatMoney(calcul.css)}</span>
            </div>
          </div>

          <div className="my-5 border-t-2 border-double border-foreground/40" />

          <div className="mb-6 flex items-baseline justify-between">
            <span className="font-sans text-sm font-bold">NET À PERCEVOIR</span>
            <span className="text-lg font-bold">{formatMoney(calcul.net_a_percevoir)} €</span>
          </div>

          <div className="rounded-lg bg-primary p-4 text-primary-foreground">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                  Provision
                  <br />
                  conseillée
                </p>
                <p className="mt-1 max-w-[16ch] font-sans text-[9px] leading-tight opacity-70">
                  À mettre de côté pour vos échéances.
                </p>
              </div>
              <span className="text-xl font-bold">{formatMoney(calcul.provision_conseillee)} €</span>
            </div>
          </div>

          <div className="mt-6 text-[9px] leading-tight opacity-40">
            <p>{qualification.explication_simple}</p>
          </div>

          <div className="mt-2 py-4 text-center text-[9px] font-bold tracking-[0.3em] opacity-60">
            MERCI DE VOTRE CONFIANCE
          </div>

          <div className="flex h-10 w-full gap-[2px] overflow-hidden opacity-80" aria-hidden>
            {[1, 2, 0.5, 3, 1, 2, 0.5, 1.5, 2, 0.5, 3, 1, 0.5, 2, 1.5, 1, 3, 0.5, 2, 1, 0.5, 2, 1.5, 3, 1].map(
              (w, i) => (
                <div key={i} style={{ width: `${w * 2}px` }} className="h-full bg-foreground" />
              ),
            )}
          </div>
        </div>

        {/* perforation bas */}
        <div
          className="h-4 w-full"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 100%, transparent 6px, var(--card) 6.5px)",
            backgroundSize: "16px 12px",
            backgroundPosition: "center bottom",
            backgroundRepeat: "repeat-x",
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  mono = true,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <Card className="p-6">
      <p className="rule-label mb-3 text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl",
          mono && "font-mono tabular-nums",
          accent && "font-medium text-accent-foreground",
        )}
      >
        {value}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

function Dashboard() {
  const { user } = useAuth();
  const greeting = user?.name?.split(" ")[0] || "vous";

  const ctx = useQuery({ queryKey: ["auth-context"], queryFn: () => api.context(), retry: false });
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: () => api.mySessions(), retry: false });

  const agent = ctx.data;
  const sessionId =
    loadSession("intake") ||
    loadSession("guidance") ||
    agent?.intake?.last_session_id ||
    agent?.guidance?.last_session_id ||
    sessions.data?.[0]?.session_id ||
    null;

  const detail = useQuery({
    queryKey: ["dashboard-session", sessionId],
    queryFn: () => api.sessionDetail(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

  const loading = ctx.isLoading || sessions.isLoading || (!!sessionId && detail.isLoading);
  const error =
    (detail.error instanceof Error && detail.error.message) ||
    (sessions.error instanceof Error && sessions.error.message) ||
    null;

  const profile = (detail.data?.profile ?? agent?.intake?.profile ?? {}) as ProfileLike;
  const diag = (detail.data?.diagnostic_profile ??
    agent?.guidance?.diagnostic_profile ??
    null) as ProfileLike | null;
  const branch = detail.data?.branch ?? (agent?.guidance?.last_session_id ? "guidance" : "intake");
  const isGuidance = branch === "guidance";

  const actions = Array.isArray(profile.recommended_actions)
    ? (profile.recommended_actions as Array<{ step: number; title: string; description?: string }>)
    : [];
  const alerts = Array.isArray(profile.compliance_alerts)
    ? (profile.compliance_alerts as Array<{ severity?: string; message?: string }>)
    : [];

  const hasPlan = actions.length > 0 || Boolean(asString(profile.recommended_regime));
  const statusLabel =
    hasPlan || asString(profile.tax_category) ? "à jour" : loading ? "…" : "en cours";

  const data = {
    qualification: profileToQualification(profile),
    calcul: profileToCalcul(profile),
  };

  const pipeline = isGuidance
    ? [
        { l: "Diagnostic", done: true },
        { l: "Feuille de route", done: Boolean(detail.data?.roadmap) || hasPlan },
        { l: "Régime", done: Boolean(asString(profile.recommended_regime)) },
        { l: "Actions", done: actions.length > 0 },
      ]
    : [
        {
          l: "Vérification",
          done:
            asString(profile.verification_status) === "verified" ||
            asString(profile.verification_status) === "skipped",
        },
        { l: "Qualification", done: !!asString(profile.tax_category) },
        { l: "Conformité", done: !!asString(profile.tax_category) },
        { l: "Rapport", done: !!asString(profile.tax_category) },
      ];

  return (
    <AppShell>
      <PageHeader
        eyebrow={`Bonjour, ${greeting}`}
        title={`Votre situation est ${statusLabel}.`}
        description={
          asString(profile.recommended_regime)
            ? `Régime recommandé : ${asString(profile.recommended_regime)}${
                asString(profile.regime_plafond)
                  ? ` (plafond ${asString(profile.regime_plafond)})`
                  : ""
              }.`
            : loading
              ? "Chargement de votre dossier…"
              : "Complétez le diagnostic ou la vérification SIREN pour alimenter ce tableau de bord."
        }
      />

      {error && (
        <div className="mb-8">
          <ErrorBlock message={error} onRetry={() => void detail.refetch()} />
        </div>
      )}

      {!loading && !sessionId && !error && (
        <Card className="mb-10 space-y-4 p-8 text-center">
          <p className="text-muted-foreground">Aucune session trouvée pour votre compte.</p>
          <ButtonLink to="/onboarding" variant="safran">
            Commencer l&apos;onboarding →
          </ButtonLink>
        </Card>
      )}

      <div className="grid items-start gap-12 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="Catégorie fiscale"
              value={
                asString(profile.tax_category) ?? asString(profile.recommended_regime) ?? "—"
              }
            />
            <Stat
              label="Provision estimée (trim.)"
              value={`${formatMoney(data.calcul.provision_conseillee)} €`}
              accent
            />
            <Stat
              label="Revenu mensuel déclaré"
              value={
                asString(profile.estimated_monthly_revenue) ??
                (Object.keys(profile).length ? formatCaLabel(diag, profile) : "—")
              }
              mono={false}
            />
            <Stat
              label="Code APE"
              value={asString(profile.ape_code) ?? "Non renseigné"}
              mono={false}
            />
          </div>

          {alerts.length > 0 && (
            <Card className="p-8">
              <h2 className="mb-4 text-lg font-semibold">Alertes de conformité</h2>
              <ul className="space-y-3">
                {alerts.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <Badge
                      tone={
                        a.severity === "critical"
                          ? "warning"
                          : a.severity === "warning"
                            ? "warning"
                            : "info"
                      }
                      className="shrink-0"
                    >
                      {a.severity || "info"}
                    </Badge>
                    {a.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pipeline de traitement</h2>
              <span className="font-mono text-[10px] uppercase tracking-widest text-accent-foreground">
                {branch === "guidance"
                  ? "Branche B · Guidance"
                  : branch === "intake"
                    ? "Branche A · Intake"
                    : loading
                      ? "…"
                      : "En attente"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {pipeline.map((p) => (
                <div key={p.l} className="space-y-2">
                  <div
                    className={cn(
                      "h-1.5 rounded-full",
                      p.done ? "bg-success" : "bg-border",
                    )}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {p.l}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {actions.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-border p-6">
                <h2 className="text-lg font-semibold">Prochaines actions</h2>
                {isGuidance && (
                  <Link
                    to="/onboarding/diagnostic/resultat"
                    search={sessionId ? ({ session: sessionId } as never) : undefined}
                    className="text-xs font-semibold text-accent-foreground hover:underline"
                    onClick={() => {
                      if (sessionId) saveSession("guidance", sessionId);
                    }}
                  >
                    Voir la feuille de route →
                  </Link>
                )}
              </div>
              <ul className="divide-y divide-border">
                {actions.slice(0, 6).map((item) => (
                  <li key={item.step} className="flex items-center justify-between gap-4 p-6">
                    <div className="flex min-w-0 items-center gap-5">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {item.step.toString().padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{item.title}</p>
                        {item.description ? (
                          <p className="truncate text-sm text-muted-foreground">{item.description}</p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {sessions.data && sessions.data.length > 1 && (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold">Autres parcours</h2>
              <ul className="space-y-2">
                {sessions.data
                  .filter((s) => s.session_id !== sessionId)
                  .slice(0, 4)
                  .map((s) => (
                    <li
                      key={s.session_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm"
                    >
                      <span className="font-medium">
                        {s.title ||
                          (s.branch === "guidance" ? "Diagnostic sans SIREN" : "Parcours SIRET")}
                      </span>
                      <Badge tone={s.phase === "done" ? "success" : "neutral"}>
                        {s.phase || "en cours"}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-24 lg:col-span-5">
          {loading ? (
            <LoadingBlock label="Chargement du reçu fiscal…" />
          ) : (
            <>
              <p className="mb-6 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-accent-foreground">
                Dernier reçu fiscal
              </p>
              <FiscalReceipt qualification={data.qualification} calcul={data.calcul} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
