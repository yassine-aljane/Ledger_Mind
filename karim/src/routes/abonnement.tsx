import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MarketingLayout } from "@/components/marketing";
import { Badge, Button, ButtonLink, Card, SectionLabel, Spinner } from "@/components/ui-kit";
import { ApiError, setPendingPremium } from "@/lib/api";
import { useAuth, useEntitlements, postAuthPath } from "@/lib/auth";

export const Route = createFileRoute("/abonnement")({
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

function Pricing() {
  const { user, activatePremium } = useAuth();
  const { isPremium, onboardingComplete } = useEntitlements();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function upgrade() {
    if (!user) {
      setPendingPremium(true);
      navigate({ to: "/auth" });
      return;
    }
    setBusy(true);
    try {
      const upgraded = await activatePremium();
      toast.success("Premium activé. Choisissez votre parcours : avec ou sans SIRET.");
      // Always start with the SIRET gate unless onboarding is already done.
      navigate({ to: postAuthPath({ ...upgraded, subscription_tier: "premium" }) });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Activation impossible pour le moment. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }

  const premiumHome =
    user && isPremium ? (onboardingComplete ? "/dashboard" : "/onboarding") : "/onboarding";

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="animate-rise max-w-2xl">
          <SectionLabel>Tarifs</SectionLabel>
          <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.6rem)] leading-[1.02]">
            Comprendre est gratuit.
            <br />
            <span className="italic text-safran">Agir change tout.</span>
          </h1>
          <p className="mt-5 text-muted-foreground">
            L'Éducation est ouverte à tous, sans compte. Premium débloque le parcours d'action.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Card className="animate-rise flex flex-col p-8">
            <Badge>Éducation</Badge>
            <p className="mt-6 font-display text-5xl">0 €</p>
            <p className="mt-2 text-sm text-muted-foreground">Sans compte, sans carte bancaire.</p>
            <ul className="mt-7 flex-1 space-y-3 text-sm">
              {ROWS.filter((r) => r[1]).map(([label]) => (
                <li key={label} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {label}
                </li>
              ))}
            </ul>
            <ButtonLink to="/education" variant="outline" className="mt-8 w-full">
              Utiliser l'Éducation
            </ButtonLink>
          </Card>

          <Card className="animate-rise surface-ink relative flex flex-col overflow-hidden border-0 p-8">
            <div className="shimmer-premium pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative flex flex-1 flex-col">
              <Badge className="border-white/30 bg-white text-ink">Premium</Badge>
              <p className="mt-6 font-display text-5xl text-ink-foreground">
                29 € <span className="font-sans text-base font-medium text-ink-foreground/60">/ mois</span>
              </p>
              <p className="mt-2 text-sm text-ink-foreground/70">
                Sans engagement. Le prix d'une heure de conseil, chaque mois.
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
                <ButtonLink to={premiumHome} variant="onInk" className="mt-8 w-full">
                  {onboardingComplete
                    ? "Votre abonnement est actif — Tableau de bord"
                    : "Votre abonnement est actif — Continuer le parcours"}
                </ButtonLink>
              ) : (
                <Button variant="safran" className="mt-8 w-full" onClick={upgrade} disabled={busy}>
                  {busy ? <Spinner /> : "Passer Premium"}
                </Button>
              )}
            </div>
          </Card>
        </div>

        <p className="mt-8 max-w-2xl text-xs text-muted-foreground">
          LedgerMind fournit une information fiscale documentée et des outils de préparation. Il ne se
          substitue pas à un expert-comptable : la mise en relation Premium existe précisément pour cela.
        </p>
      </div>
    </MarketingLayout>
  );
}
