import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/lm/AppShell";

export const Route = createFileRoute("/education")({
  head: () => ({
    meta: [
      { title: "Éducation fiscale — LedgerMind" },
      { name: "description", content: "Des fiches courtes, en français simple, pour tout comprendre." },
      { property: "og:title", content: "Éducation fiscale — LedgerMind" },
      {
        property: "og:description",
        content: "Des fiches courtes, en français simple, pour tout comprendre.",
      },
    ],
  }),
  component: EducationPage,
});

const articles = [
  { c: "TVA", t: "Quand faut-il vraiment collecter la TVA ?", r: "4 min" },
  { c: "Statut", t: "Micro-BNC ou micro-BIC : comment choisir ?", r: "6 min" },
  { c: "URSSAF", t: "Vos cotisations, décodées ligne par ligne", r: "5 min" },
  { c: "International", t: "Facturer un client étranger sans se tromper", r: "7 min" },
  { c: "Cadeaux", t: "Les cadeaux en nature : imposables ou pas ?", r: "3 min" },
  { c: "Provision", t: "La règle des 30 % : mythe ou méthode ?", r: "4 min" },
];

function EducationPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Éducation"
        title={
          <>
            Apprenez à votre rythme, <span className="italic font-normal">sans jargon.</span>
          </>
        }
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {articles.map((a) => (
          <a
            key={a.t}
            href="#"
            className="group bg-white border border-border rounded-2xl p-6 hover:border-ink transition-colors block"
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-teal-dark mb-6">
              {a.c}
            </p>
            <h3 className="text-lg font-semibold text-balance leading-snug group-hover:text-teal-dark transition-colors">
              {a.t}
            </h3>
            <p className="mt-6 text-xs text-ink/40 font-mono uppercase tracking-widest">
              Lecture · {a.r}
            </p>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
