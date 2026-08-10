/**
 * Page de génération du rapport fiscal.
 *
 * Elle relève de « Ma situation », pas du parcours de facturation : un rapport ne se produit
 * pas à la suite d'une facture, il se produit quand on veut faire le point. D'où une page à
 * part, atteinte depuis le tableau de bord.
 *
 * Tout le contenu vit dans `RapportFiscalPanel` — cette route n'est qu'un cadre : en-tête,
 * contrôle d'accès, retour vers le tableau de bord.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { RapportFiscalPanel } from "@/components/lm/RapportFiscal";
import { Button } from "@/components/ui/button";
import { isAuthed } from "@/lib/auth";

export const Route = createFileRoute("/rapport")({
  head: () => ({
    meta: [
      { title: "Générer un rapport — LedgerMind" },
      {
        name: "description",
        content:
          "Rapport fiscal fondé sur le chiffre d'affaires encaissé : rapprochement de vos " +
          "factures et de vos virements, impôt et cotisations estimés.",
      },
    ],
  }),
  component: RapportRoute,
});

function RapportRoute() {
  return (
    <AccessGate feature="dashboard" premiumKind="dashboard">
      <RapportPage />
    </AccessGate>
  );
}

function RapportPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthed()) navigate({ to: "/auth", replace: true });
  }, [navigate]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Ma situation"
        title={
          <>
            Générer un <span className="italic font-normal">rapport fiscal.</span>
          </>
        }
        description="Impôt et cotisations estimés sur le chiffre d'affaires réellement encaissé."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft /> Ma situation
            </Link>
          </Button>
        }
      />
      <RapportFiscalPanel />
    </AppShell>
  );
}
