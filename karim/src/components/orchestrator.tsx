import { useRef, useState } from "react";
import { Upload, ShieldCheck, AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, DataRow, Spinner, Textarea } from "./ui-kit";
import { cn } from "@/lib/utils";

/* --------- Rendu générique de valeurs backend (contrats souples) --------- */

export function humanKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return <span className="font-mono tabular-nums">{value}</span>;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <ul className="space-y-1 text-left">
        {value.map((v, i) => (
          <li key={i} className="text-sm">
            {typeof v === "object" && v !== null ? <KeyValueList data={v as Record<string, unknown>} /> : renderValue(v)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") return <KeyValueList data={value as Record<string, unknown>} />;
  return String(value);
}

export function KeyValueList({
  data,
  exclude = [],
  className,
}: {
  data: Record<string, unknown>;
  exclude?: string[];
  className?: string;
}) {
  const entries = Object.entries(data).filter(
    ([k, v]) => !exclude.includes(k) && v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return null;
  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {entries.map(([k, v]) => (
        <DataRow key={k} label={humanKey(k)} value={renderValue(v)} />
      ))}
    </dl>
  );
}

/* --------------------- Barre de progression du parcours --------------------- */

export function CompletenessRail({ value }: { value?: number | null }) {
  const pct = Math.max(0, Math.min(100, Math.round(((value ?? 0) > 1 ? (value ?? 0) : (value ?? 0) * 100))));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="rule-label text-muted-foreground">Profil complété</span>
        <span className="font-mono text-sm tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-[image:var(--gradient-safran)] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ Question agent ------------------------------ */

export function QuestionCard({
  message,
  quickReplies,
  onAnswer,
  busy,
}: {
  message?: string | null;
  quickReplies?: string[] | null;
  onAnswer: (answer: string) => void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="border-b border-border bg-secondary/50 px-6 py-5">
        <p className="rule-label mb-2 text-muted-foreground">Question de l'agent</p>
        <p className="text-lg leading-relaxed text-foreground">{message || "…"}</p>
      </div>
      <div className="space-y-4 p-6">
        {!!quickReplies?.length && (
          <div className="flex flex-wrap gap-2">
            {quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => onAnswer(q)}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-soft disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onAnswer(text.trim());
            setText("");
          }}
          className="space-y-3"
        >
          <Textarea
            rows={3}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder="Répondez librement…"
            aria-label="Votre réponse"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy ? <Spinner /> : <ArrowRight />} Envoyer
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

/* --------------------------- Étape terminée (succès) --------------------------- */

export function StepDoneCard({
  step,
  title,
  detail,
}: {
  step: number;
  title: string;
  detail?: string;
}) {
  return (
    <Card className="animate-rise border-success/30 bg-success/5 p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="text-left">
          <p className="rule-label text-success">Étape {step} · Validée</p>
          <p className="mt-1 font-semibold">{title}</p>
          {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
    </Card>
  );
}

/* --------------------------- Résultat de vérification --------------------------- */

export function VerificationResult({
  profile,
  message,
  onContinue,
  onRetry,
  busy,
}: {
  profile: Record<string, unknown>;
  /** Backend puts the explanation on the turn message, not always on the profile. */
  message?: string | null;
  onContinue?: () => void;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const mismatches = (profile.mismatches as unknown[] | undefined) ?? [];
  const microEligible = profile.micro_eligible as boolean | undefined;
  const verified = profile.verification_status === "verified";
  const explanation =
    (typeof profile.explanation === "string" && profile.explanation) ||
    (typeof message === "string" && message) ||
    null;

  return (
    <Card className="animate-seal overflow-hidden">
      <div className="surface-ink px-6 py-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5 text-accent" />
          <p className="rule-label text-ink-foreground/70">
            {verified ? "Vérification officielle" : "Vérification incomplète"}
          </p>
        </div>
        <h2 className="mt-3 text-2xl text-ink-foreground">
          {(profile.denomination as string) ||
            (verified ? "Établissement vérifié" : "Identité non confirmée")}
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone={verified ? "success" : "warning"}>
            {verified ? "Identité confirmée" : "Non vérifié"}
          </Badge>
          {profile.legal_form ? <Badge tone="ink">{String(profile.legal_form)}</Badge> : null}
          {profile.ape_code ? <Badge tone="ink">APE {String(profile.ape_code)}</Badge> : null}
          {microEligible !== undefined && (
            <Badge tone={microEligible ? "success" : "warning"}>
              {microEligible ? "Éligible micro-entreprise" : "Non éligible micro"}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-5 p-6">
        {mismatches.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
              <AlertTriangle className="size-4" /> Écarts détectés
            </p>
            <div className="mt-2 text-sm text-foreground">{renderValue(mismatches)}</div>
          </div>
        )}

        {explanation ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{explanation}</p>
        ) : null}

        <KeyValueList
          data={profile}
          exclude={[
            "explanation",
            "mismatches",
            "denomination",
            "legal_form",
            "ape_code",
            "micro_eligible",
            "verification_status",
          ]}
        />

        {verified && onContinue ? (
          <Button onClick={onContinue} disabled={busy} className="w-full sm:w-auto">
            {busy ? <Spinner /> : <ArrowRight />} Continuer le parcours
          </Button>
        ) : null}
        {!verified && onRetry ? (
          <Button onClick={onRetry} disabled={busy} variant="outline" className="w-full sm:w-auto">
            Réessayer avec un autre numéro
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/* --------------------------------- Upload --------------------------------- */

export function UploadCard({
  title,
  description,
  accept = "image/*,application/pdf",
  busy,
  onFile,
  ctaLabel = "Choisir un fichier",
}: {
  title: string;
  description?: string;
  accept?: string;
  busy?: boolean;
  onFile: (file: File) => void;
  ctaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <Card
      className={cn(
        "animate-rise border-dashed p-8 text-center transition-colors",
        drag && "border-accent bg-accent/5",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <Upload className="mx-auto size-6 text-muted-foreground" />
      <h3 className="mt-4 text-lg">{title}</h3>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        className="mt-5"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner /> : <Upload />} {ctaLabel}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">Glissez-déposez également votre document ici.</p>
    </Card>
  );
}
