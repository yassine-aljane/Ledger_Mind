/**
 * Page de préparation des déclarations.
 *
 * Déclarer ne prolonge pas la facturation : c'est une obligation à échéance fixe, qui vaut même
 * sans facture émise sur la période. D'où une page atteinte directement depuis le rail, et non
 * une étape du parcours de facturation.
 *
 * Tout le contenu vit dans `DeclarationsPanel` — cette route n'est qu'un cadre : en-tête,
 * contrôle d'accès, redirection si non connecté.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEffect } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { DeclarationsPanel } from "@/components/lm/Declarations";
import { Button } from "@/components/ui/button";
import { isAuthed } from "@/lib/auth";

export const Route = createFileRoute("/declaration")({
  head: () => ({
    meta: [
      { title: "Déclaration — LedgerMind" },
      {
        name: "description",
        content:
          "Brouillons de déclaration prêts à recopier : URSSAF, revenus 2042-C-PRO, TVA, " +
          "CFE. Rien n'est transmis à l'administration.",
      },
    ],
  }),
  component: DeclarationRoute,
});

function DeclarationRoute() {
  return (
    <AccessGate feature="activite" premiumKind="activite">
      <DeclarationPage />
    </AccessGate>
  );
}

function DeclarationPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthed()) navigate({ to: "/auth", replace: true });
  }, [navigate]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Déclaration"
        title={
          <>
            Vos déclarations <span className="italic font-normal">préparées.</span>
          </>
        }
        description="Chaque brouillon reproduit le formulaire officiel, champ par champ. Rien n'est transmis : vous recopiez et validez vous-même sur le site de l'administration."
        actions={
          /* Un brouillon reste un brouillon : le faire relire ou signer se décide ici, au
             moment où la question se pose. La page /referral porte son propre contrôle d'accès. */
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/referral">
              <Users className="size-3.5" /> Contacter un expert-comptable
            </Link>
          </Button>
        }
      />
      <DeclarationsPanel />
    </AppShell>
  );
}
