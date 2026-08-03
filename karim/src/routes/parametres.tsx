import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AuthGate, ParcoursStrip, UpsellStrip } from "@/components/paywall";
import { LogOut } from "lucide-react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataRow,
  LoadingBlock,
  SectionLabel,
} from "@/components/ui-kit";
import { api } from "@/lib/api";
import { useAuth, useEntitlements } from "@/lib/auth";
import { loadSession } from "@/lib/session-store";

export const Route = createFileRoute("/parametres")({
  head: () => ({
    meta: [
      { title: "Profil — LedgerMind" },
      { name: "description", content: "Votre nom, email et formule d'abonnement." },
      { property: "og:title", content: "Profil — LedgerMind" },
    ],
  }),
  component: () => (
    <AuthGate>
      <Parametres />
    </AuthGate>
  ),
});

function Parametres() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isPremium, tier } = useEntitlements();
  const me = useQuery({ queryKey: ["auth-me"], queryFn: () => api.me(), retry: false });

  const ctx = useQuery({
    queryKey: ["auth-context"],
    queryFn: () => api.context(),
    enabled: isPremium,
    retry: false,
  });

  const guidance = ctx.data?.guidance ?? me.data?.agent_context?.guidance;
  const intake = ctx.data?.intake ?? me.data?.agent_context?.intake;
  const sessionId =
    loadSession("guidance") ||
    guidance?.last_session_id ||
    loadSession("intake") ||
    intake?.last_session_id ||
    null;

  const detail = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () => api.sessionDetail(sessionId!),
    enabled: isPremium && !!sessionId,
    retry: false,
  });

  const diag = detail.data?.diagnostic_profile ?? guidance?.diagnostic_profile;
  const regime =
    (detail.data?.profile?.recommended_regime as string | undefined) ||
    guidance?.recommended_regime ||
    null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Compte"
        title="Profil"
        description={
          isPremium
            ? "Identité, formule et synthèse de votre parcours fiscal."
            : "Votre identité et votre formule. Les outils fiscaux sont réservés à Premium."
        }
      />

      {!isPremium && (
        <div className="mb-6">
          <UpsellStrip text="Sur Free : Éducation + ce profil. Passez Premium pour le parcours, la capture, les cabinets et le tableau de bord." />
        </div>
      )}
      {isPremium && (
        <div className="mb-6">
          <ParcoursStrip />
        </div>
      )}

      <div className={isPremium ? "grid gap-6 lg:grid-cols-2" : "max-w-lg"}>
        <Card className="p-6">
          <SectionLabel>Identité</SectionLabel>
          {me.isLoading && <LoadingBlock />}
          <dl className="mt-4">
            <DataRow label="Nom" value={user?.name || me.data?.name} />
            <DataRow label="Email" value={user?.email || me.data?.email} />
            <DataRow
              label="Formule"
              value={
                <Badge tone={isPremium ? "accent" : "neutral"}>
                  {tier === "premium" ? "Premium" : "Free"}
                </Badge>
              }
            />
          </dl>
          {!isPremium && (
            <ButtonLink to="/abonnement" variant="safran" className="mt-6">
              Passer Premium
            </ButtonLink>
          )}
          {isPremium && (
            <ButtonLink to="/education" variant="outline" className="mt-6">
              Ouvrir l'Éducation
            </ButtonLink>
          )}
        </Card>

        <Card className="p-6">
          <SectionLabel>Session</SectionLabel>
          <p className="mt-2 text-sm text-muted-foreground">
            Déconnectez-vous pour changer de compte ou revenir en mode visiteur sur l'Éducation.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              signOut();
              void navigate({ to: "/auth" });
            }}
          >
            <LogOut className="size-4" /> Se déconnecter
          </Button>
        </Card>

        {isPremium && (
          <Card className="p-6">
            <SectionLabel>Synthèse guidance</SectionLabel>
            {ctx.isLoading && <LoadingBlock />}
            {regime ? (
              <>
                <p className="mt-4 text-lg font-medium">{regime}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {(detail.data?.roadmap?.bandeau as { texte?: string } | undefined)?.texte ||
                    "Votre feuille de route a été construite à partir du diagnostic."}
                </p>
                <dl className="mt-4">
                  <DataRow label="Activité" value={diag?.activite || "—"} />
                  <DataRow
                    label="CA estimé"
                    value={
                      diag?.ca_estime_annuel != null
                        ? `≈ ${Math.round(diag.ca_estime_annuel).toLocaleString("fr-FR")} € / an`
                        : "—"
                    }
                  />
                  <DataRow label="Phase intake" value={intake?.phase || "—"} />
                  <DataRow label="Phase guidance" value={guidance?.phase || "—"} />
                </dl>
                {sessionId && (
                  <ButtonLink
                    to="/onboarding/diagnostic/resultat"
                    search={{ session: sessionId } as never}
                    variant="outline"
                    className="mt-6"
                  >
                    Ouvrir la feuille de route
                  </ButtonLink>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Aucun diagnostic terminé.{" "}
                <ButtonLink to="/onboarding" variant="outline" size="sm" className="ml-1">
                  Démarrer
                </ButtonLink>
              </p>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
