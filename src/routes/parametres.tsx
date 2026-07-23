import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/lm/AppShell";

export const Route = createFileRoute("/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres — LedgerMind" },
      { name: "description", content: "Votre profil, vos préférences et vos accès." },
      { property: "og:title", content: "Paramètres — LedgerMind" },
      { property: "og:description", content: "Votre profil, vos préférences et vos accès." },
    ],
  }),
  component: ParametresPage,
});

function ParametresPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Paramètres" title="Votre profil" />
      <div className="grid lg:grid-cols-3 gap-6">
        {[
          { l: "Identité", v: "Alexandre Martin" },
          { l: "SIRET", v: "832 174 902 00019", mono: true },
          { l: "Régime", v: "Micro-BNC" },
          { l: "Devise principale", v: "EUR" },
          { l: "Département", v: "75 · Paris" },
          { l: "Notifications", v: "Actives" },
        ].map((f) => (
          <div key={f.l} className="bg-white border border-border rounded-2xl p-6">
            <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-3">
              {f.l}
            </p>
            <p className={`${f.mono ? "font-mono" : ""} text-lg font-medium`}>{f.v}</p>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
