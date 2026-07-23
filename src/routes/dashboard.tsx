import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FiscalReceipt } from "@/components/lm/FiscalReceipt";
import { fetchLatestReceipt, formatMoney, type Calcul, type Qualification } from "@/lib/api-mock";

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

function DashboardPage() {
  const [data, setData] = useState<{ qualification: Qualification; calcul: Calcul } | null>(null);
  useEffect(() => {
    fetchLatestReceipt().then(setData);
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bonjour, Alexandre"
        title={
          <>
            Votre situation est <span className="italic font-normal">à jour.</span>
          </>
        }
        description="Voici votre dernier reçu fiscal et la provision recommandée pour vos prochaines échéances."
      />

      <div className="grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Stat label="CA du trimestre" value={`${formatMoney(12450)} €`} />
            <Stat
              label="Provision totale"
              value={`${formatMoney(2926)} €`}
              accent
            />
            <Stat label="TVA collectée" value={`${formatMoney(2365)} €`} />
            <Stat label="Prochaine échéance" value="30 nov." mono={false} />
          </div>

          <section className="bg-white border border-border rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Pipeline de traitement</h2>
              <span className="text-[10px] font-mono uppercase tracking-widest text-teal-dark">
                Opérationnel
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { l: "Extraction", c: "bg-teal-light" },
                { l: "Qualification", c: "bg-teal-light" },
                { l: "Calcul", c: "bg-coral" },
                { l: "Rapport", c: "bg-purple-flow" },
              ].map((p) => (
                <div key={p.l} className="space-y-2">
                  <div className={`h-1.5 rounded-full ${p.c}`} />
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                    {p.l}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white border border-border rounded-2xl overflow-hidden">
            <div className="p-6 flex items-center justify-between border-b border-border">
              <h2 className="text-lg font-semibold">Prochaines actions</h2>
              <Link to="/historique" className="text-xs uppercase tracking-widest text-teal-dark font-semibold">
                Voir tout →
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {[
                {
                  n: "01",
                  t: "Déclaration URSSAF T4",
                  d: "À soumettre avant le 30 novembre",
                  cta: "Préparer",
                },
                {
                  n: "02",
                  t: "Provision mensuelle",
                  d: "330 € à isoler cette semaine",
                  cta: "Marquer fait",
                },
              ].map((item) => (
                <li key={item.n} className="p-6 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-5 min-w-0">
                    <span className="font-mono text-xs text-ink/40 shrink-0">{item.n}</span>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{item.t}</p>
                      <p className="text-sm text-ink/60 truncate">{item.d}</p>
                    </div>
                  </div>
                  <button className="shrink-0 px-4 py-2 bg-background border border-border rounded-full text-xs font-semibold hover:border-ink transition-colors">
                    {item.cta}
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
