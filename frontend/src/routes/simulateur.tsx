import { createFileRoute } from "@tanstack/react-router";
import { AccessGate } from "@/components/lm/AccessGate";
import { Play } from "lucide-react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/simulateur")({
  head: () => ({
    meta: [
      { title: "Scénarios — LedgerMind" },
      { name: "description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
      { property: "og:title", content: "Scénarios — LedgerMind" },
      { property: "og:description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
    ],
  }),
  component: SimulateurRoute,
});

function SimulateurRoute() {
  return (
    <AccessGate feature="simulateur" premiumKind="simulateur">
      <SimulateurPage />
    </AccessGate>
  );
}

function SimulateurPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Scénarios"
        title={
          <>
            Et si je signais <span className="italic font-normal">ce contrat ?</span>
          </>
        }
        description="Décrivez la situation en français simple, on vous montre l'impact fiscal, ligne par ligne."
      />

      <div className="animate-rise rounded-2xl border border-border bg-card p-6 shadow-soft">
        <label htmlFor="sim-situation" className="rule-label text-muted-foreground">
          Votre situation
        </label>
        <textarea
          id="sim-situation"
          rows={4}
          defaultValue="Si je signe ce contrat de 5000 € avec un client français, combien je garde ?"
          className="mt-3 w-full resize-none border-b border-border bg-transparent py-3 text-base transition-colors duration-200 focus:border-ink focus:outline-none"
        />
        <Button size="lg" variant="accent" className="mt-6">
          <Play /> Simuler
        </Button>
      </div>

      <div className="animate-rise mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                <th className="rule-label px-5 py-3.5 text-left text-muted-foreground">Scénario</th>
                {["Net perçu", "Provision", "Impact"].map((h) => (
                  <th key={h} className="rule-label px-5 py-3.5 text-right text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { s: "Actuel", n: "0,00", p: "0,00", i: "—" },
                { s: "+ Contrat 5 000 €", n: "4 025,00", p: "660,00", i: "+ 4 025 €" },
                { s: "+ Contrat 15 000 €", n: "12 075,00", p: "1 980,00", i: "+ 12 075 €" },
              ].map((r) => (
                <tr key={r.s} className="transition-colors duration-150 hover:bg-secondary/40">
                  <td className="px-5 py-3.5 font-medium">{r.s}</td>
                  <td className="num px-5 py-3.5 text-right">{r.n} €</td>
                  <td className="num px-5 py-3.5 text-right text-amber-fiscal">{r.p} €</td>
                  <td className="num px-5 py-3.5 text-right text-teal-dark">{r.i}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
