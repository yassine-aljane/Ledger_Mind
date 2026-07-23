import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/lm/AppShell";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — LedgerMind" },
      { name: "description", content: "Déposez vos factures, relevés et justificatifs." },
      { property: "og:title", content: "Documents — LedgerMind" },
      { property: "og:description", content: "Déposez vos factures, relevés et justificatifs." },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Documents"
        title={
          <>
            Déposez, on <span className="italic font-normal">s'occupe du reste.</span>
          </>
        }
        description="PDF, images, CSV ou Excel — chaque document est extrait, qualifié, calculé et transformé en reçu fiscal."
      />

      <label className="block bg-white border border-dashed border-border hover:border-teal-dark transition-colors rounded-2xl p-20 text-center cursor-pointer">
        <input type="file" multiple className="sr-only" />
        <div className="mx-auto size-16 rounded-full bg-teal-dark/10 grid place-items-center mb-6">
          <span className="text-3xl text-teal-dark">↑</span>
        </div>
        <p className="font-semibold text-lg">Glissez vos fichiers ici</p>
        <p className="text-sm text-ink/50 mt-2">ou cliquez pour parcourir · 10 fichiers max · 20 Mo chacun</p>
      </label>

      <div className="mt-10 grid grid-cols-4 gap-3">
        {[
          { l: "Extraction", c: "bg-teal-light", s: "Prêt" },
          { l: "Qualification", c: "bg-teal-light", s: "Prêt" },
          { l: "Calcul", c: "bg-coral", s: "Prêt" },
          { l: "Rapport", c: "bg-purple-flow", s: "Prêt" },
        ].map((p) => (
          <div key={p.l} className="bg-white border border-border rounded-2xl p-5">
            <div className={`h-1.5 w-10 rounded-full ${p.c} mb-4`} />
            <p className="text-sm font-semibold">{p.l}</p>
            <p className="text-xs text-ink/50 mt-1">{p.s}</p>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
