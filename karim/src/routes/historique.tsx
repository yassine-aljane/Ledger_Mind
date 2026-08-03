import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  formatDate,
} from "@/components/ui-kit";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/session-store";

export const Route = createFileRoute("/historique")({
  head: () => ({
    meta: [
      { title: "Historique — LedgerMind" },
      {
        name: "description",
        content: "Sessions guidance/intake et conversations pédagogiques.",
      },
      { property: "og:title", content: "Historique — LedgerMind" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="historique"
      title="Votre historique"
      pitch="Retrouvez tous vos parcours et conversations fiscales en un seul endroit."
      benefits={[
        "Sessions intake et diagnostic",
        "Conversations Éducation persistées",
        "Suppression et reprise en un clic",
      ]}
      preview={
        <Card className="p-8">
          <p className="font-medium">Diagnostic sans SIREN</p>
          <p className="mt-1 text-sm text-muted-foreground">guidance · diagnostic_roadmap · hier</p>
        </Card>
      }
    >
      <Historique />
    </PremiumGate>
  );
}

function Historique() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: () => api.mySessions(), retry: false });
  const conversations = useQuery({
    queryKey: ["education-conversations"],
    queryFn: () => api.conversations(),
    retry: false,
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow="Premium"
        title="Historique"
        description="Sessions d'onboarding / guidance et conversations de l'assistant fiscal."
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-6 py-4">
            <h2 className="font-semibold">Guidance & intake</h2>
            <p className="mt-1 text-xs text-muted-foreground">Sessions orchestrateur</p>
          </div>
          {sessions.isLoading && <LoadingBlock />}
          {sessions.isError && (
            <div className="p-6">
              <ErrorBlock message="Impossible de charger les sessions." onRetry={() => void sessions.refetch()} />
            </div>
          )}
          {sessions.data?.length === 0 && (
            <EmptyState title="Aucune session" description="Lancez un parcours pour commencer." />
          )}
          <ul className="divide-y divide-border">
            {sessions.data?.map((s) => (
              <li key={s.session_id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {s.title ||
                      (s.branch === "guidance" ? "Diagnostic sans SIREN" : "Profil SIREN")}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {s.branch || "—"} · {s.phase || "—"} · {formatDate(s.updated_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.branch === "guidance" && (
                      <ButtonLink
                        to="/onboarding/diagnostic/resultat"
                        search={{ session: s.session_id } as never}
                        variant="outline"
                        size="sm"
                        onClick={() => saveSession("guidance", s.session_id)}
                      >
                        Ouvrir la feuille de route
                      </ButtonLink>
                    )}
                    <Badge>{s.phase || "en cours"}</Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer"
                  onClick={async () => {
                    await api.deleteSession(s.session_id);
                    void qc.invalidateQueries({ queryKey: ["my-sessions"] });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-6 py-4">
            <h2 className="font-semibold">Éducation</h2>
            <p className="mt-1 text-xs text-muted-foreground">Conversations pédagogiques</p>
          </div>
          {conversations.isLoading && <LoadingBlock />}
          {conversations.isError && (
            <div className="p-6">
              <ErrorBlock
                message="Impossible de charger les conversations."
                onRetry={() => void conversations.refetch()}
              />
            </div>
          )}
          {conversations.data?.length === 0 && (
            <EmptyState
              title="Aucune conversation"
              description="Posez une question dans Éducation."
              action={<ButtonLink to="/education" variant="safran">Ouvrir Éducation</ButtonLink>}
            />
          )}
          <ul className="divide-y divide-border">
            {conversations.data?.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.title || "Sans titre"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(c.updated_at)}</p>
                  <Link
                    to="/education"
                    className="mt-2 inline-block text-sm underline decoration-accent underline-offset-4"
                  >
                    Ouvrir
                  </Link>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer"
                  onClick={async () => {
                    await api.deleteConversation(c.id);
                    void qc.invalidateQueries({ queryKey: ["education-conversations"] });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
