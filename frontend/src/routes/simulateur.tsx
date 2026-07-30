import { createFileRoute } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import { PremiumPagePlaceholder } from "@/components/lm/PremiumPagePlaceholder";
import { AppShell, PageHeader } from "@/components/lm/AppShell";

export const Route = createFileRoute("/simulateur")({
  head: () => ({
    meta: [
      { title: "Simulateur — LedgerMind" },
      { name: "description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
      { property: "og:title", content: "Simulateur — LedgerMind" },
      { property: "og:description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
    ],
  }),
  component: SimulateurPage,
});

function SimulateurPage() {
  if (usePlan() === "free") return <PremiumPagePlaceholder kind="simulateur" />;
  return (
    <AppShell>
      <PageHeader
        eyebrow="Simulateur"
        title={
          <>
            Et si je signais <span className="italic font-normal">ce contrat ?</span>
          </>
        }
        description="Décrivez la situation en français simple, on vous montre l'impact fiscal, ligne par ligne."
      />

      <div className="bg-white border border-border rounded-2xl p-8">
        <label className="text-xs uppercase tracking-widest text-ink/50 font-semibold">
          Votre situation
        </label>
        <textarea
          rows={4}
          defaultValue="Si je signe ce contrat de 5000 € avec un client français, combien je garde ?"
          className="w-full mt-3 px-0 py-3 bg-transparent border-b border-border text-lg focus:outline-none focus:border-ink transition-colors resize-none"
        />
        <button className="mt-6 px-8 py-4 bg-ink text-background rounded-xl font-semibold hover:bg-teal-dark transition-colors">
          Simuler
        </button>
      </div>

      <div className="mt-10 overflow-hidden bg-white border border-border rounded-2xl">
        <table className="w-full">
          <thead className="bg-background">
            <tr className="text-xs uppercase tracking-widest text-ink/50">
              <th className="text-left px-6 py-4 font-semibold">Scénario</th>
              <th className="text-right px-6 py-4 font-semibold">Net perçu</th>
              <th className="text-right px-6 py-4 font-semibold">Provision</th>
              <th className="text-right px-6 py-4 font-semibold">Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-sm">
            {[
              { s: "Actuel", n: "0,00", p: "0,00", i: "—" },
              { s: "+ Contrat 5 000 €", n: "4 025,00", p: "660,00", i: "+ 4 025 €" },
              { s: "+ Contrat 15 000 €", n: "12 075,00", p: "1 980,00", i: "+ 12 075 €" },
            ].map((r) => (
              <tr key={r.s} className="hover:bg-background/50">
                <td className="px-6 py-4 font-sans font-medium">{r.s}</td>
                <td className="px-6 py-4 text-right">{r.n} €</td>
                <td className="px-6 py-4 text-right text-amber-fiscal">{r.p} €</td>
                <td className="px-6 py-4 text-right text-teal-dark">{r.i}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
