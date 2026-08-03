import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import { RoadmapView } from "@/components/roadmap-view";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  SectionLabel,
  Spinner,
} from "@/components/ui-kit";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DEMO_ROADMAP } from "@/lib/demo";
import { loadSession, saveSession } from "@/lib/session-store";
import type { DiagnosticProfile, Roadmap, SessionDetail } from "@/lib/types";

export const Route = createFileRoute("/onboarding/diagnostic/resultat")({
  validateSearch: (search: Record<string, unknown>): { session?: string } => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Ma feuille de route fiscale — LedgerMind" },
      {
        name: "description",
        content:
          "Régime recommandé, seuils applicables, étapes datées et sources légales : votre feuille de route fiscale personnalisée.",
      },
      { property: "og:title", content: "Ma feuille de route fiscale — LedgerMind" },
      { property: "og:description", content: "Vos prochaines démarches, dans l'ordre." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PremiumGate
      feature="onboarding"
      title="Votre feuille de route personnalisée"
      pitch="Le résultat concret du diagnostic : quoi faire, quand, et sur quel fondement légal."
      benefits={[
        "Étapes datées et priorisées",
        "Seuils suivis pour éviter les mauvaises surprises",
        "Sources légales citées, année de référence affichée",
        "Export PDF et checklist interactive",
      ]}
      preview={<RoadmapView roadmap={DEMO_ROADMAP} />}
    >
      <Resultat />
    </PremiumGate>
  );
}

function Resultat() {
  const { refresh } = useAuth();
  const { session: sessionFromUrl } = Route.useSearch();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [editCa, setEditCa] = useState("");
  const [editActivite, setEditActivite] = useState("");

  const sessionId =
    sessionFromUrl || loadSession("guidance") || detail?.session_id || null;

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const d = await api.sessionDetail(sessionId);
        if (!alive) return;
        saveSession("guidance", d.session_id);
        setDetail(d);
        setChecked(d.roadmap_checked ?? {});
        await refresh();
        setEditCa(
          d.diagnostic_profile?.ca_estime_annuel != null
            ? String(d.diagnostic_profile.ca_estime_annuel)
            : "",
        );
        setEditActivite(d.diagnostic_profile?.activite || "");
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : "Feuille de route indisponible.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const roadmap = detail?.roadmap as Roadmap | null | undefined;
  const diag = detail?.diagnostic_profile as DiagnosticProfile | null | undefined;
  const options = detail?.options;
  const etapes = useMemo(() => {
    const fromPhases =
      (roadmap?.phases as Array<{ etapes?: Array<Record<string, unknown>> }> | undefined)?.flatMap(
        (p) => p.etapes ?? [],
      ) ?? [];
    const fromRoot = (roadmap?.etapes as Array<Record<string, unknown>> | undefined) ?? [];
    return (fromPhases.length ? fromPhases : fromRoot) as Array<Record<string, unknown>>;
  }, [roadmap]);

  async function toggleStep(id: string) {
    if (!sessionId) return;
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    try {
      await api.saveRoadmapChecked(sessionId, next);
    } catch {
      toast.error("Impossible d'enregistrer la checklist.");
    }
  }

  async function applyParcours(choix: "micro" | "societe") {
    if (!sessionId) return;
    setBusy("parcours");
    try {
      const d = await api.chooseParcours(sessionId, choix);
      setDetail(d);
      setChecked(d.roadmap_checked ?? {});
      toast.success(choix === "micro" ? "Parcours micro sélectionné." : "Parcours société sélectionné.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Choix impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function rebuild() {
    if (!sessionId) return;
    setBusy("rebuild");
    try {
      const ca = editCa.trim() ? Number(editCa.replace(/\s/g, "").replace(",", ".")) : undefined;
      const d = await api.patchDiagnosticProfile(sessionId, {
        activite: editActivite.trim() || undefined,
        ca_estime_annuel: Number.isFinite(ca) ? ca : undefined,
        rebuild_roadmap: true,
      });
      setDetail(d);
      setChecked(d.roadmap_checked ?? {});
      toast.success("Feuille de route mise à jour.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Mise à jour impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (!sessionId) return;
    setBusy("pdf");
    try {
      const blob = await api.downloadRoadmapPdf(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledgermind-roadmap-${sessionId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export PDF impossible.");
    } finally {
      setBusy(null);
    }
  }

  if (!sessionId)
    return (
      <AppShell>
        <PageHeader title="Feuille de route" />
        <EmptyState
          title="Aucun diagnostic terminé"
          description="Lancez le diagnostic sans SIREN pour générer votre feuille de route."
          action={
            <ButtonLink to="/onboarding/diagnostic" variant="safran">
              Démarrer le diagnostic
            </ButtonLink>
          }
        />
      </AppShell>
    );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Résultat du diagnostic"
        title="Votre feuille de route"
        description="Chaque étape est déterministe et rattachée à une source officielle."
        actions={
          <Button variant="outline" onClick={() => void downloadPdf()} disabled={busy === "pdf"}>
            {busy === "pdf" ? <Spinner /> : <Download />} PDF
          </Button>
        }
      />
      {loading && <LoadingBlock label="Chargement de votre feuille de route…" />}
      {error && <ErrorBlock message={error} />}

      {detail && (
        <div className="space-y-6">
          <Card className="grid gap-4 p-6 sm:grid-cols-3">
            <div>
              <SectionLabel>Activité</SectionLabel>
              <p className="mt-2 font-medium">{diag?.activite || "—"}</p>
            </div>
            <div>
              <SectionLabel>CA estimé</SectionLabel>
              <p className="mt-2 font-medium">
                {diag?.ca_estime_annuel != null
                  ? `≈ ${Math.round(diag.ca_estime_annuel).toLocaleString("fr-FR")} € / an`
                  : "—"}
              </p>
            </div>
            <div>
              <SectionLabel>Parcours</SectionLabel>
              <p className="mt-2 font-medium">
                {diag?.choix_parcours === "societe"
                  ? "Société"
                  : diag?.choix_parcours === "micro"
                    ? "Micro"
                    : roadmap?.parcours || "—"}
              </p>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <SectionLabel>Ajuster et reconstruire</SectionLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Activité" htmlFor="edit-act">
                <Input
                  id="edit-act"
                  value={editActivite}
                  onChange={(e) => setEditActivite(e.target.value)}
                  placeholder="Ex. création de contenu"
                />
              </Field>
              <Field label="CA annuel estimé (€)" htmlFor="edit-ca">
                <Input
                  id="edit-ca"
                  inputMode="decimal"
                  value={editCa}
                  onChange={(e) => setEditCa(e.target.value)}
                  placeholder="32000"
                />
              </Field>
            </div>
            <Button variant="safran" onClick={() => void rebuild()} disabled={busy === "rebuild"}>
              {busy === "rebuild" ? <Spinner /> : null} Recalculer la feuille de route
            </Button>
          </Card>

          {options?.kind === "choix_parcours" && (
            <Card className="p-6">
              <SectionLabel>Zone d'arbitrage</SectionLabel>
              <p className="mt-2 text-sm text-muted-foreground">{options.prompt}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {options.choices.map((c) => (
                  <Button
                    key={c.value}
                    variant={diag?.choix_parcours === c.value ? "safran" : "outline"}
                    disabled={busy === "parcours"}
                    onClick={() => void applyParcours(c.value as "micro" | "societe")}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              {roadmap?.comparatif && (
                <pre className="mt-4 overflow-x-auto rounded-xl bg-secondary/50 p-4 text-xs">
                  {JSON.stringify(roadmap.comparatif, null, 2)}
                </pre>
              )}
            </Card>
          )}

          {roadmap && <RoadmapView roadmap={roadmap} />}

          {etapes.length > 0 && (
            <Card className="p-6">
              <SectionLabel>Checklist interactive</SectionLabel>
              <ul className="mt-4 space-y-3">
                {etapes.map((etape, i) => {
                  const id = String(etape.id || `step-${i}`);
                  return (
                    <li
                      key={id}
                      className="flex items-start gap-3 rounded-xl border border-border p-4"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!checked[id]}
                        onChange={() => void toggleStep(id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{String(etape.titre || `Étape ${i + 1}`)}</p>
                          {etape.obligatoire ? (
                            <Badge tone="warning">Obligatoire</Badge>
                          ) : (
                            <Badge>Recommandé</Badge>
                          )}
                          {etape.duree ? <Badge tone="info">{String(etape.duree)}</Badge> : null}
                          {etape.cout ? <Badge tone="neutral">{String(etape.cout)}</Badge> : null}
                        </div>
                        {Boolean(etape.detail || etape.description) && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {String(etape.detail || etape.description)}
                          </p>
                        )}
                        {etape.lien ? (
                          <a
                            href={String(etape.lien)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-sm underline decoration-accent underline-offset-4"
                          >
                            Lien officiel <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionLabel>Suite</SectionLabel>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirmez pour alimenter votre tableau de bord, ou continuez vers l'éducation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to="/education" variant="outline">
                Éducation
              </ButtonLink>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/onboarding/diagnostic" })}
              >
                Refaire le diagnostic
              </Button>
              <ButtonLink to="/dashboard" variant="safran">
                Tableau de bord
              </ButtonLink>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
