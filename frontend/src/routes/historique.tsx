import { createFileRoute } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import { PremiumPagePlaceholder } from "@/components/lm/PremiumPagePlaceholder";
import { AppShell, PageHeader } from "@/components/lm/AppShell";

export const Route = createFileRoute("/historique")({
  head: () => ({
    meta: [
      { title: "Historique — LedgerMind" },
      { name: "description", content: "Toutes vos transactions qualifiées et leurs reçus fiscaux." },
      { property: "og:title", content: "Historique — LedgerMind" },
      {
        property: "og:description",
        content: "Toutes vos transactions qualifiées et leurs reçus fiscaux.",
      },
    ],
  }),
  component: HistoriquePage,
});

const rows = [
  { r: "LM-2026-0082", c: "Studio Aurore SAS", d: "14 nov.", m: "2 500,00", n: "2 725,00", s: "Qualifié" },
  { r: "LM-2026-0081", c: "Freelance UK Ltd.", d: "09 nov.", m: "1 800,00", n: "1 800,00", s: "Qualifié" },
  { r: "LM-2026-0080", c: "Cadeau — Marque X", d: "02 nov.", m: "450,00", n: "450,00", s: "En revue" },
  { r: "LM-2026-0079", c: "Sponsor Instagram", d: "28 oct.", m: "3 200,00", n: "3 088,00", s: "Qualifié" },
];

function HistoriquePage() {
  if (usePlan() === "free") return <PremiumPagePlaceholder kind="historique" />;
  return (
    <AppShell>
      <PageHeader
        eyebrow="Historique"
        title={
          <>
            Vos transactions, <span className="italic font-normal">expliquées.</span>
          </>
        }
      />

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-background">
            <tr className="text-[11px] uppercase tracking-widest text-ink/50">
              <th className="text-left px-6 py-4 font-semibold">Référence</th>
              <th className="text-left px-6 py-4 font-semibold">Client</th>
              <th className="text-left px-6 py-4 font-semibold">Date</th>
              <th className="text-right px-6 py-4 font-semibold">HT</th>
              <th className="text-right px-6 py-4 font-semibold">Net</th>
              <th className="text-right px-6 py-4 font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.r} className="hover:bg-background/60 transition-colors cursor-pointer">
                <td className="px-6 py-4 font-mono text-xs">{row.r}</td>
                <td className="px-6 py-4 font-medium">{row.c}</td>
                <td className="px-6 py-4 text-ink/60">{row.d}</td>
                <td className="px-6 py-4 text-right font-mono">{row.m} €</td>
                <td className="px-6 py-4 text-right font-mono font-medium">{row.n} €</td>
                <td className="px-6 py-4 text-right">
                  <span
                    className={`text-[10px] uppercase tracking-widest font-semibold ${
                      row.s === "Qualifié" ? "text-teal-dark" : "text-amber-fiscal"
                    }`}
                  >
                    {row.s}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
