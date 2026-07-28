import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FiscalReceipt } from "@/components/lm/FiscalReceipt";
import {
  fetchUserProfile,
  formatMoney,
  getStoredSessionId,
  type UserProfile,
} from "@/lib/api";
import type { Calcul, Qualification } from "@/lib/api-mocks";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — LedgerMind" },
      { name: "description", content: "Votre situation fiscale, en un coup d'œil." },
      { property: "og:title", content: "Dashboard — LedgerMind" },
      { property: "og:description", content: "Votre situation fiscale, en un coup d'œil." },
    ],
  }),
  component: DashboardPage,
});

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
  const monthly = digits ? parseInt(digits, 10) : 2500;
  const ht = monthly * 3;
  const tva = profile.international_clients ? ht * 0.2 : 0;
  const rs = profile.tax_category === "BNC" ? ht * 0.1 : 0;
  return {
    reference: `LM-${profile.siren ?? "NEW"}-${new Date().getFullYear()}`,
    client: profile.denomination ?? "Votre activité",
    date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    montant_ht: ht,
    tva,
    retenue_source: rs,
    css: ht * 0.01,
    net_a_percevoir: ht + tva - rs - ht * 0.01,
    provision_conseillee: Math.round(ht * 0.22),
  };
}

function DashboardPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const sessionId = getStoredSessionId();
    if (!sessionId) {
      navigate({ to: "/onboarding" });
      return;
    }
    fetchUserProfile(sessionId)
      .then(setProfile)
      .catch(() => navigate({ to: "/onboarding" }));
  }, [navigate]);

  const greeting = profile?.denomination?.split(" ")[0] ?? "Créateur";
  const hasAlerts = (profile?.compliance_alerts.length ?? 0) > 0;
  const statusLabel = hasAlerts ? "des points à vérifier" : "à jour";

  const data = profile
    ? { qualification: profileToQualification(profile), calcul: profileToCalcul(profile) }
    : null;

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
            ? `Régime recommandé : ${profile.recommended_regime} (plafond ${profile.regime_plafond}).`
            : "Voici votre dernier reçu fiscal et la provision recommandée pour vos prochaines échéances."
        }
      />

      <div className="grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Stat
              label="Catégorie fiscale"
              value={profile?.tax_category ?? "—"}
            />
            <Stat
              label="Provision estimée (trim.)"
              value={data ? `${formatMoney(data.calcul.provision_conseillee)} €` : "—"}
              accent
            />
            <Stat
              label="Revenu mensuel déclaré"
              value={profile?.estimated_monthly_revenue ?? "—"}
              mono={false}
            />
            <Stat
              label="Code APE"
              value={profile?.ape_code ?? "Non renseigné"}
              mono={false}
            />
          </div>

          {profile && profile.compliance_alerts.length > 0 && (
            <section className="bg-white border border-border rounded-2xl p-8">
              <h2 className="text-lg font-semibold mb-4">Alertes de conformité</h2>
              <ul className="space-y-3">
                {profile.compliance_alerts.map((a, i) => (
                  <li key={i} className="text-sm text-ink/70 flex gap-2">
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                        a.severity === "critical"
                          ? "bg-coral/10 text-coral"
                          : a.severity === "warning"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-teal-dark/10 text-teal-dark"
                      }`}
                    >
                      {a.severity}
                    </span>
                    {a.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="bg-white border border-border rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Pipeline de traitement</h2>
              <span className="text-[10px] font-mono uppercase tracking-widest text-teal-dark">
                {profile?.tax_category ? "Opérationnel" : "En attente"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { l: "Vérification", done: profile?.verification_status === "verified" || profile?.verification_status === "skipped" },
                { l: "Qualification", done: !!profile?.tax_category },
                { l: "Conformité", done: !!profile?.tax_category },
                { l: "Rapport", done: !!profile?.tax_category },
              ].map((p) => (
                <div key={p.l} className="space-y-2">
                  <div className={`h-1.5 rounded-full ${p.done ? "bg-teal-light" : "bg-border"}`} />
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                    {p.l}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {profile && profile.recommended_actions.length > 0 && (
            <section className="bg-white border border-border rounded-2xl overflow-hidden">
              <div className="p-6 flex items-center justify-between border-b border-border">
                <h2 className="text-lg font-semibold">Prochaines actions</h2>
              </div>
              <ul className="divide-y divide-border">
                {profile.recommended_actions.map((item) => (
                  <li key={item.step} className="p-6 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-5 min-w-0">
                      <span className="font-mono text-xs text-ink/40 shrink-0">
                        {item.step.toString().padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{item.title}</p>
                        <p className="text-sm text-ink/60 truncate">{item.description}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-24 animate-slide-up">
          {data ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark text-center mb-6">
                Dernier reçu fiscal
              </p>
              <FiscalReceipt qualification={data.qualification} calcul={data.calcul} />
            </>
          ) : (
            <div className="text-ink/40 font-mono text-sm text-center">Chargement…</div>
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
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="bg-white border border-border rounded-2xl p-6">
      <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-3">{label}</p>
      <p
        className={`${mono ? "font-mono" : ""} text-2xl ${
          accent ? "text-amber-fiscal font-medium" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
