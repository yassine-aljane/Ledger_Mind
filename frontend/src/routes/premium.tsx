import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Loader2, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { MarketingLayout } from "@/components/lm/Marketing";
import { Button } from "@/components/ui/button";
import { accessState, landingPathFor, useEntitlements } from "@/lib/entitlements";
import { markPremiumPending, setPlan } from "@/lib/plan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Offre Premium — LedgerMind" },
      {
        name: "description",
        content:
          "Free : l'Éducation fiscale sourcée. Premium : parcours d'immatriculation, feuille de route, capture de factures et mise en relation avec des cabinets.",
      },
      { property: "og:title", content: "Offre Premium — LedgerMind" },
      {
        property: "og:description",
        content: "Passez de comprendre à agir : feuille de route, factures, cabinets.",
      },
    ],
  }),
  component: Pricing,
});

/** [libellé, inclus au gratuit, inclus au Premium] */
const ROWS: Array<[string, boolean, boolean]> = [
  ["Questions fiscales illimitées, réponses sourcées BOFiP", true, true],
  ["Agent pédagogique complet — sans inscription", true, true],
  ["Alertes de fraîcheur et textes périmés signalés", true, true],
  ["Historique sauvegardé (avec compte)", false, true],
  ["Diagnostic sans SIREN en quelques minutes", false, true],
  ["Vérification SIRET officielle et immatriculation guidée", false, true],
  ["Feuille de route personnalisée (étapes, seuils, échéances)", false, true],
  ["Analyse de factures et virements + détection de doublons", false, true],
  ["Emails prêts à envoyer à des cabinets comptables", false, true],
  ["Tableau de bord et historique complet", false, true],
];

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="rule-label text-muted-foreground">
      <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
      {children}
    </p>
  );
}

function Pastille({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Pricing() {
  const navigate = useNavigate();
  const { authed, isPremium, parcoursDone } = useEntitlements();
  const [busy, setBusy] = useState(false);

  /**
   * Activation (démo, sans paiement).
   *
   * Déconnecté : la formule est attachée à un compte, on ne peut donc pas l'activer tout de
   * suite. On mémorise l'intention et on passe par l'authentification, qui l'honorera au retour.
   * Connecté : on pose la formule, puis on envoie là où son nouvel état donne accès — le
   * parcours s'il reste à faire, le tableau de bord sinon.
   */
  function upgrade() {
    if (!authed) {
      markPremiumPending();
      navigate({ to: "/auth" });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      setPlan("premium");
      setBusy(false);
      toast.success("Premium activé. Choisissez votre parcours : avec ou sans SIRET.");
      navigate({ to: landingPathFor(accessState(true, "premium", parcoursDone)) });
    }, 700);
  }

  const premiumHome = parcoursDone ? "/dashboard" : "/onboarding";

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="animate-rise max-w-2xl">
          <SectionLabel>Tarifs</SectionLabel>
          <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.6rem)] leading-[1.02]">
            Comprendre est gratuit.
            <br />
            <span className="text-safran italic">Agir change tout.</span>
          </h1>
          <p className="mt-5 text-muted-foreground">
            L&apos;Éducation est ouverte à tous, sans compte. Premium débloque le parcours
            d&apos;action.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Card className="animate-rise flex flex-col p-8">
            <Pastille>Éducation</Pastille>
            <p className="num mt-6 text-5xl">0 €</p>
            <p className="mt-2 text-sm text-muted-foreground">Sans compte, sans carte bancaire.</p>
            <ul className="mt-7 flex-1 space-y-3 text-sm">
              {ROWS.filter((r) => r[1]).map(([label]) => (
                <li key={label} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-success-ink" /> {label}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="mt-8 w-full">
              <Link to="/education">Utiliser l&apos;Éducation</Link>
            </Button>
          </Card>

          <Card className="animate-rise surface-ink relative flex flex-col overflow-hidden border-0 p-8">
            <div className="shimmer-premium pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative flex flex-1 flex-col">
              <Pastille className="border-ink-foreground/30 bg-ink-foreground text-ink">
                Premium
              </Pastille>
              <p className="num mt-6 text-5xl text-ink-foreground">
                29 €{" "}
                <span className="font-sans text-base font-medium text-ink-foreground/60">
                  / mois
                </span>
              </p>
              <p className="mt-2 text-sm text-ink-foreground/70">
                Sans engagement. Le prix d&apos;une heure de conseil, chaque mois.
              </p>
              <ul className="mt-7 flex-1 space-y-3 text-sm text-ink-foreground/85">
                {ROWS.map(([label, , premium]) => (
                  <li key={label} className="flex gap-3">
                    {premium ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    ) : (
                      <Minus className="mt-0.5 size-4 shrink-0 opacity-40" />
                    )}
                    {label}
                  </li>
                ))}
              </ul>
              {isPremium ? (
                <Button
                  asChild
                  className="mt-8 w-full bg-ink-foreground text-ink hover:bg-ink-foreground/90"
                >
                  <Link to={premiumHome}>
                    {parcoursDone
                      ? "Votre abonnement est actif — Tableau de bord"
                      : "Votre abonnement est actif — Continuer le parcours"}
                  </Link>
                </Button>
              ) : (
                <Button variant="accent" className="mt-8 w-full" onClick={upgrade} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : "Passer Premium"}
                </Button>
              )}
            </div>
          </Card>
        </div>

        <p className="mt-8 max-w-2xl text-xs text-muted-foreground">
          LedgerMind fournit une information fiscale documentée et des outils de préparation. Il ne
          se substitue pas à un expert-comptable : la mise en relation Premium existe précisément
          pour cela.
        </p>
      </div>
    </MarketingLayout>
  );
}
