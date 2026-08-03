import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Mail } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PremiumGate } from "@/components/paywall";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Spinner,
  formatDate,
} from "@/components/ui-kit";
import { api, ApiError } from "@/lib/api";
import type { ReferralEmail, ReferralResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/referral")({
  head: () => ({
    meta: [
      { title: "Mise en relation cabinets — LedgerMind" },
      {
        name: "description",
        content:
          "Indiquez votre ville : LedgerMind trouve des cabinets proches et rédige des emails prêts à envoyer.",
      },
      { property: "og:title", content: "Mise en relation cabinets — LedgerMind" },
      { property: "og:description", content: "Ville → cabinets → emails prêts." },
    ],
  }),
  component: Page,
});

const DEFAULT_DEMANDE =
  "Je suis auto-entrepreneur et je cherche un expert-comptable pour m'accompagner dans ma déclaration fiscale et mes obligations comptables.";

function Page() {
  return (
    <PremiumGate
      feature="referral"
      title="Mise en relation avec des cabinets"
      pitch="Indiquez votre ville : on trouve des cabinets proches et on rédige les emails."
      benefits={[
        "Recherche de cabinets près de chez vous",
        "Emails personnalisés prêts à envoyer",
        "Historique de vos prises de contact",
      ]}
      preview={
        <Card className="p-8">
          <Badge tone="accent">Email généré</Badge>
          <p className="mt-4 font-medium">Objet : Accompagnement micro-BNC — première année</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Bonjour, je suis prestataire indépendant à Lyon, en micro-BNC depuis mars…
          </p>
        </Card>
      }
    >
      <Referral />
    </PremiumGate>
  );
}

function Referral() {
  const [ville, setVille] = useState("");
  const [result, setResult] = useState<ReferralResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const history = useQuery({
    queryKey: ["referral-history"],
    queryFn: () => api.referralHistory(),
    retry: false,
  });

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const city = ville.trim();
    if (!city || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setExpanded(null);
    try {
      const res = await api.referralGenerate({ ville: city, demande: DEFAULT_DEMANDE });
      if (res.status === "echec") {
        setError(res.error || "Aucun cabinet trouvé.");
        return;
      }
      setResult(res);
      void history.refetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Recherche impossible.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const emails = result?.emails ?? [];
  const cabinetsCount = result?.cabinets_count ?? emails.length;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Premium"
        title="Trouver un expert-comptable"
        description="Indiquez votre ville. LedgerMind cherche des cabinets proches et génère un email pour chacun."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card className="p-6 sm:p-8">
            <form onSubmit={(e) => void handleGenerate(e)} className="space-y-5">
              <Field label="Ville" htmlFor="ville">
                <Input
                  id="ville"
                  value={ville}
                  onChange={(e) => setVille(e.target.value)}
                  placeholder="ex. Lyon, Marseille, Bordeaux…"
                  maxLength={80}
                  autoComplete="address-level2"
                />
              </Field>
              <Button
                type="submit"
                variant="safran"
                disabled={busy || ville.trim().length < 2}
                className="w-full sm:w-auto"
              >
                {busy ? <Spinner /> : null}
                {busy ? "Recherche en cours…" : "Trouver & générer"}
              </Button>
            </form>
          </Card>

          {error && <ErrorBlock message={error} />}

          {busy && (
            <Card className="p-10 text-center">
              <Spinner className="mx-auto size-8" />
              <p className="mt-4 text-sm text-muted-foreground">
                Recherche de cabinets et génération des emails… 30 à 60 secondes.
              </p>
            </Card>
          )}

          {!busy && emails.length > 0 && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {cabinetsCount} cabinet{cabinetsCount > 1 ? "s" : ""} trouvé
                  {cabinetsCount > 1 ? "s" : ""}
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {emails.length} email{emails.length > 1 ? "s" : ""} généré
                  {emails.length > 1 ? "s" : ""}
                </span>
              </div>

              {emails.map((em, i) => (
                <EmailCard
                  key={`${em.destinataire}-${i}`}
                  email={em}
                  open={expanded === i}
                  onToggle={() => setExpanded(expanded === i ? null : i)}
                />
              ))}
            </section>
          )}
        </div>

        <aside>
          <Card className="p-5">
            <h2 className="text-lg">Historique</h2>
            {history.isLoading && <LoadingBlock />}
            {history.isError && (
              <ErrorBlock
                message="Historique indisponible."
                onRetry={() => void history.refetch()}
              />
            )}
            {history.data?.length === 0 && (
              <EmptyState title="Aucune demande" description="Vos recherches apparaîtront ici." />
            )}
            <ul className="mt-3 space-y-2">
              {history.data?.map((h, i) => (
                <li key={i} className="rounded-xl border border-border p-3 text-sm">
                  <p className="font-medium">{h.ville}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(h.created_at)} · {h.cabinets_count ?? h.emails?.length ?? 0}{" "}
                    cabinet(s)
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

function EmailCard({
  email,
  open,
  onToggle,
}: {
  email: ReferralEmail;
  open: boolean;
  onToggle: () => void;
}) {
  const tone =
    email.statut === "ok"
      ? "success"
      : email.statut === "email_introuvable"
        ? "warning"
        : email.statut
          ? "danger"
          : "neutral";

  const statutLabel =
    email.statut === "ok"
      ? "Prêt à envoyer"
      : email.statut === "email_introuvable"
        ? "Email manquant"
        : email.statut || "—";

  return (
    <Card className="animate-rise overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 p-6 text-left transition-colors hover:bg-secondary/40"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold">{email.destinataire}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {email.email ?? "Email non trouvé"} · {statutLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {email.statut && <Badge tone={tone}>{statutLabel}</Badge>}
          <ChevronDown
            className={cn("size-5 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-6">
          <div>
            <p className="rule-label mb-1 text-muted-foreground">Objet</p>
            <p className="text-sm font-medium">{email.objet}</p>
          </div>
          <div>
            <p className="rule-label mb-1 text-muted-foreground">Corps</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {email.corps}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(`${email.objet}\n\n${email.corps}`);
                toast.success("Email copié.");
              }}
            >
              <Copy /> Copier
            </Button>
            {email.email && (
              <a
                href={`mailto:${encodeURIComponent(email.email)}?subject=${encodeURIComponent(email.objet)}&body=${encodeURIComponent(email.corps)}`}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                <Mail className="size-4" /> Ouvrir dans ma messagerie
              </a>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
