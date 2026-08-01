import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Loader2, Minus, Sparkles } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setPlan, usePlan } from "@/lib/plan";
import { cn } from "@/lib/utils";

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
            className={cn(
              "animate-rise relative overflow-hidden rounded-3xl border p-8 transition-all duration-300 hover:-translate-y-1 md:p-10",
              t.highlight
                ? "surface-ink border-ink shadow-lift"
                : "card-hover border-border bg-card",
            )}
          >
            {t.highlight && (
              <>
                <div className="absolute -right-24 -top-24 size-72 rounded-full bg-accent/30 blur-3xl" />
                <div className="surface-grain absolute inset-0 opacity-50" />
              </>
            )}
            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <span
                  className={cn(
                    "rule-label",
                    t.highlight ? "text-accent" : "text-accent-ink",
                  )}
                >
                  {t.name}
                </span>
                {t.highlight && <Badge variant="accent">Recommandé</Badge>}
              </div>

              <div className="flex items-baseline gap-2 mb-4">
                <span className="num text-4xl font-medium">{t.price}</span>
                <span
                  className={cn(
                    "text-sm",
                    t.highlight ? "text-ink-foreground/60" : "text-muted-foreground",
                  )}
                >
                  {t.tag}
                </span>
              </div>
              <p
                className={cn(
                  "mb-8 text-sm",
                  t.highlight ? "text-ink-foreground/70" : "text-muted-foreground",
                )}
              >
                {t.desc}
              </p>

              <ul className="space-y-3 mb-10">
                {t.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full",
                        f.on
                          ? t.highlight
                            ? "bg-accent text-accent-foreground"
                            : "bg-success text-success-foreground"
                          : t.highlight
                            ? "bg-ink-foreground/10 text-ink-foreground/40"
                            : "bg-border text-muted-foreground",
                      )}
                    >
                      {f.on ? <Check className="size-3" /> : <Minus className="size-3" />}
                    </span>
                    <span
                      className={cn(
                        !f.on &&
                          (t.highlight
                            ? "text-ink-foreground/40 line-through"
                            : "text-muted-foreground line-through"),
                      )}
                    >
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>

              {t.id === "premium" ? (
                <Button
                  type="button"
                  size="lg"
                  variant="accent"
                  onClick={activate}
                  disabled={loading || plan === "premium"}
                  className="w-full rounded-full"
                >
                  {plan === "premium" ? (
                    <>
                      <Check /> Premium actif
                    </>
                  ) : loading ? (
                    <>
                      <Loader2 className="animate-spin" /> Activation…
                    </>
                  ) : (
                    <>
                      <Sparkles /> Démarrer l&apos;essai — 14 jours
                    </>
                  )}
                </Button>
              ) : (
                <div className="rule-label w-full py-4 text-center text-muted-foreground">
                  Plan actuel par défaut
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Social proof / faux testimonial strip */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-10 shadow-soft md:p-14">
        <div className="surface-grain absolute inset-0" />
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
            className="rule-label text-muted-foreground transition-colors duration-200 hover:text-destructive"
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
      <p className="num mb-2 text-3xl font-medium">{k}</p>
      <p className="text-sm text-muted-foreground">{v}</p>
    </div>
  );
}
