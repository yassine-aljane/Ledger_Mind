import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { setPlan, usePlan } from "@/lib/plan";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Premium — LedgerMind" },
      { name: "description", content: "Débloquez toute la puissance fiscale de LedgerMind." },
      { property: "og:title", content: "Passez Premium — LedgerMind" },
      { property: "og:description", content: "Diagnostic, capture, simulateur, historique et expert-comptable." },
    ],
  }),
  component: PremiumPage,
});

const TIERS = [
  {
    id: "free",
    name: "Gratuit",
    price: "0 €",
    tag: "Toujours",
    desc: "Pour comprendre les bases de la fiscalité française.",
    features: [
      { on: true, label: "Fiches Éducation illimitées" },
      { on: true, label: "Recherche dans le glossaire fiscal" },
      { on: false, label: "Diagnostic personnalisé" },
      { on: false, label: "Reçus fiscaux & pipeline" },
      { on: false, label: "Simulateur de contrat" },
      { on: false, label: "Mise en relation expert-comptable" },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: "12 €",
    tag: "/ mois",
    desc: "L'assistant fiscal complet, comme un cabinet dans votre poche.",
    highlight: true,
    features: [
      { on: true, label: "Tout du Gratuit" },
      { on: true, label: "Diagnostic & régime recommandé" },
      { on: true, label: "OCR factures & justificatifs" },
      { on: true, label: "Reçus fiscaux + provisions" },
      { on: true, label: "Simulateur en langage naturel" },
      { on: true, label: "Historique & export comptable" },
      { on: true, label: "Emails d'expert-comptable automatisés" },
    ],
  },
];

function PremiumPage() {
  const navigate = useNavigate();
  const plan = usePlan();
  const [loading, setLoading] = useState(false);

  function activate() {
    setLoading(true);
    setTimeout(() => {
      setPlan("premium");
      setLoading(false);
      navigate({ to: "/dashboard" });
    }, 700);
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Premium"
        title={
          <>
            Débloquez la <span className="italic font-normal">totalité</span> de votre cabinet.
          </>
        }
        description="14 jours d'essai. Sans engagement. Résiliation en un clic."
      />

      <div className="grid md:grid-cols-2 gap-6 mb-16">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className={`relative rounded-3xl border p-8 md:p-10 overflow-hidden ${
              t.highlight
                ? "border-ink bg-ink text-background shadow-[0_40px_80px_-40px_rgba(22,36,31,0.5)]"
                : "border-border bg-white"
            }`}
          >
            {t.highlight && (
              <>
                <div className="absolute -top-24 -right-24 size-72 rounded-full bg-amber-fiscal/30 blur-3xl" />
                <div className="absolute inset-0 grain-overlay opacity-40" />
              </>
            )}
            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <span
                  className={`font-mono text-[11px] uppercase tracking-[0.25em] ${
                    t.highlight ? "text-amber-fiscal" : "text-teal-dark"
                  }`}
                >
                  {t.name}
                </span>
                {t.highlight && (
                  <span className="px-3 py-1 rounded-full bg-amber-fiscal text-ink font-mono text-[10px] uppercase tracking-widest">
                    Recommandé
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-extrabold tracking-tighter">{t.price}</span>
                <span className={`text-sm ${t.highlight ? "text-background/60" : "text-ink/50"}`}>
                  {t.tag}
                </span>
              </div>
              <p className={`text-sm mb-8 ${t.highlight ? "text-background/70" : "text-ink/60"}`}>
                {t.desc}
              </p>

              <ul className="space-y-3 mb-10">
                {t.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-3 text-sm">
                    <span
                      className={`size-5 shrink-0 rounded-full flex items-center justify-center text-[10px] ${
                        f.on
                          ? t.highlight
                            ? "bg-teal-light text-ink"
                            : "bg-teal-dark text-background"
                          : t.highlight
                            ? "bg-background/10 text-background/40"
                            : "bg-border text-ink/30"
                      }`}
                    >
                      {f.on ? "✓" : "—"}
                    </span>
                    <span
                      className={
                        f.on
                          ? ""
                          : t.highlight
                            ? "text-background/40 line-through"
                            : "text-ink/40 line-through"
                      }
                    >
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>

              {t.id === "premium" ? (
                <button
                  type="button"
                  onClick={activate}
                  disabled={loading || plan === "premium"}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-background text-ink rounded-full text-sm font-semibold hover:bg-amber-fiscal hover:text-ink transition-colors disabled:opacity-60"
                >
                  {plan === "premium"
                    ? "Premium actif ✓"
                    : loading
                      ? "Activation…"
                      : "Démarrer l'essai — 14 jours"}
                </button>
              ) : (
                <div className="w-full text-center text-xs text-ink/40 font-mono uppercase tracking-widest py-4">
                  Plan actuel par défaut
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Social proof / faux testimonial strip */}
      <section className="bg-white border border-border rounded-3xl p-10 md:p-14 relative overflow-hidden">
        <div className="absolute inset-0 grain-overlay" />
        <div className="relative grid md:grid-cols-3 gap-10">
          <Metric k="2 400+" v="freelances accompagnés" />
          <Metric k="18 h" v="économisées par mois en moyenne" />
          <Metric k="0" v="pénalité fiscale rapportée en 2025" />
        </div>
      </section>

      {plan === "premium" && (
        <div className="mt-12 text-center">
          <button
            type="button"
            onClick={() => setPlan("free")}
            className="text-xs font-mono uppercase tracking-widest text-ink/40 hover:text-coral"
          >
            (démo) revenir au plan gratuit
          </button>
        </div>
      )}
    </AppShell>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-4xl font-extrabold tracking-tighter mb-2">{k}</p>
      <p className="text-sm text-ink/60">{v}</p>
    </div>
  );
}
