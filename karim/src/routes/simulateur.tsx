import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { Button, Card, Textarea } from "@/components/ui-kit";

export const Route = createFileRoute("/simulateur")({
  head: () => ({
    meta: [
      { title: "Simulateur — LedgerMind" },
      { name: "description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
      { property: "og:title", content: "Simulateur — LedgerMind" },
      { property: "og:description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="simulateur"
      title="Simulateur fiscal"
      pitch="Décrivez une situation en français : LedgerMind estime net, provision et impact."
      benefits={[
        "Scénarios en langage naturel",
        "Comparaison avant / après contrat",
        "Provision fiscale estimée",
      ]}
      preview={
        <Card className="p-8">
          <p className="text-sm text-muted-foreground">Exemple</p>
          <p className="mt-2 font-medium">+ Contrat 5 000 € → net ≈ 4 025 €</p>
        </Card>
      }
    >
      <Simulateur />
    </PremiumGate>
  );
}

const ROWS = [
  { s: "Actuel", n: "0,00", p: "0,00", i: "—" },
  { s: "+ Contrat 5 000 €", n: "4 025,00", p: "660,00", i: "+ 4 025 €" },
  { s: "+ Contrat 15 000 €", n: "12 075,00", p: "1 980,00", i: "+ 12 075 €" },
];

function Simulateur() {
  const [scenario, setScenario] = useState(
    "Si je signe ce contrat de 5000 € avec un client français, combien je garde ?",
  );
  const [shown, setShown] = useState(false);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Premium · aperçu"
        title="Et si je signais ce contrat ?"
        description="Décrivez la situation en français simple. Le moteur de simulation backend n'est pas encore branché — résultats illustratifs."
      />

      <Card className="p-8">
        <label className="rule-label text-muted-foreground">Votre situation</label>
        <Textarea
          className="mt-3"
          rows={4}
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        />
        <Button className="mt-6" variant="safran" onClick={() => setShown(true)}>
          Simuler
        </Button>
      </Card>

      {shown && (
        <Card className="mt-8 overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-secondary/50">
              <tr className="text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-6 py-4 text-left font-semibold">Scénario</th>
                <th className="px-6 py-4 text-right font-semibold">Net perçu</th>
                <th className="px-6 py-4 text-right font-semibold">Provision</th>
                <th className="px-6 py-4 text-right font-semibold">Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-sm">
              {ROWS.map((r) => (
                <tr key={r.s}>
                  <td className="px-6 py-4 font-sans font-medium">{r.s}</td>
                  <td className="px-6 py-4 text-right">{r.n} €</td>
                  <td className="px-6 py-4 text-right">{r.p} €</td>
                  <td className="px-6 py-4 text-right text-success">{r.i}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}
