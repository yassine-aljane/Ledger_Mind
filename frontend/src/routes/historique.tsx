import { createFileRoute } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";

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
  component: HistoriqueRoute,
});

function HistoriqueRoute() {
  return (
    <AccessGate feature="historique" premiumKind="historique">
      <HistoriquePage />
    </AccessGate>
  );
}

const rows = [
  { r: "LM-2026-0082", c: "Studio Aurore SAS", d: "14 nov.", m: "2 500,00", n: "2 725,00", s: "Qualifié" },
  { r: "LM-2026-0081", c: "Freelance UK Ltd.", d: "09 nov.", m: "1 800,00", n: "1 800,00", s: "Qualifié" },
  { r: "LM-2026-0080", c: "Cadeau — Marque X", d: "02 nov.", m: "450,00", n: "450,00", s: "En revue" },
  { r: "LM-2026-0079", c: "Sponsor Instagram", d: "28 oct.", m: "3 200,00", n: "3 088,00", s: "Qualifié" },
];

function HistoriquePage() {
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

      <div className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                {["Référence", "Client", "Date"].map((h) => (
                  <th key={h} className="rule-label px-5 py-3.5 text-left text-muted-foreground">
                    {h}
                  </th>
                ))}
                {["HT", "Net", "Statut"].map((h) => (
                  <th key={h} className="rule-label px-5 py-3.5 text-right text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={row.r}
                  className="cursor-pointer transition-colors duration-150 hover:bg-secondary/40"
                >
                  <td className="num px-5 py-3.5 text-xs text-muted-foreground">{row.r}</td>
                  <td className="px-5 py-3.5 font-medium">{row.c}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{row.d}</td>
                  <td className="num px-5 py-3.5 text-right">{row.m} €</td>
                  <td className="num px-5 py-3.5 text-right font-medium">{row.n} €</td>
                  <td className="px-5 py-3.5 text-right">
                    <Badge variant={row.s === "Qualifié" ? "success" : "warning"}>{row.s}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
