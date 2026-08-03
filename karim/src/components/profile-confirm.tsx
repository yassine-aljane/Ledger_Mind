import { useState } from "react";
import { CheckCircle2, LifeBuoy } from "lucide-react";
import { Badge, Button, ButtonLink, Card, Input, Spinner } from "./ui-kit";
import { cn } from "@/lib/utils";

export type EditableIntakeProfile = {
  denomination?: string | null;
  siret?: string | null;
  siren?: string | null;
  tax_category?: string | null;
  recommended_regime?: string | null;
  regime_plafond?: string | null;
  tax_category_reason?: string | null;
  fiscal_classification_status?: string | null;
  fiscal_inconsistency_reason?: string | null;
  activity_mismatch?: boolean;
  mismatches?: Array<{ note?: string }>;
  activity_types?: string[];
  revenue_sources?: string[];
  currencies?: string[];
  estimated_monthly_revenue?: string | null;
  estimated_annual_revenue?: string | null;
  first_income_date?: string | null;
  revenue_variability?: "stable" | "spiky" | "unknown" | null;
  international_clients?: boolean | null;
  invoices_already_issued?: boolean | null;
  has_recurring_contracts?: boolean | null;
  in_kind_gifts?: boolean | null;
  has_secondary_activity?: boolean | null;
  secondary_activity_types?: string[];
  main_activity_commercial?: boolean | null;
};

type Patch = Partial<EditableIntakeProfile> & { reclassify?: boolean };

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function ChipRow({ items, tone = "accent" }: { items: string[]; tone?: "accent" | "neutral" | "success" }) {
  if (!items.length) return <span className="text-sm italic text-muted-foreground">Non renseigné</span>;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.map((item) => (
        <Badge key={item} tone={tone === "neutral" ? "neutral" : tone === "success" ? "success" : "info"}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

function FieldRow({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <span className="rule-label text-muted-foreground">{label}</span>
        {children}
      </div>
      {action ? <div className="shrink-0 self-start sm:self-center">{action}</div> : null}
    </div>
  );
}

function EditButton({
  active,
  onClick,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline disabled:opacity-50"
    >
      {active ? "Valider" : "Modifier"}
    </button>
  );
}

export function ProfileConfirmEditor({
  profile,
  message,
  expert,
  busy,
  confirming,
  onPatch,
  onConfirm,
  onRestart,
}: {
  profile: EditableIntakeProfile;
  message?: string | null;
  expert?: boolean;
  busy?: boolean;
  confirming?: boolean;
  onPatch: (patch: Patch) => Promise<void> | void;
  onConfirm: () => void;
  onRestart?: () => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const saving = Boolean(busy);

  async function commit(patch: Patch) {
    await onPatch({ ...patch, reclassify: true });
    setEditingField(null);
  }

  return (
    <div className="animate-seal space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rule-label text-accent-foreground">Validation Human-in-the-Loop</p>
          <h2 className="mt-2 text-2xl sm:text-3xl">
            Vérifiez et ajustez <span className="italic font-normal">votre profil</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {message ||
              "Ces informations viennent de la vérification SIRET et de vos réponses. Modifiez ce qui doit l'être avant de confirmer."}
          </p>
        </div>
        {onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-destructive"
          >
            ↺ Recommencer
          </button>
        ) : null}
      </div>

      {(profile.denomination || profile.siret) && (
        <Card className="border-accent/25 bg-accent/5 p-5">
          <p className="rule-label text-accent-foreground">Vérification SIRET</p>
          <p className="mt-2 font-semibold">{profile.denomination || "—"}</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{profile.siret || profile.siren}</p>
          {(profile.recommended_regime || profile.tax_category) && (
            <p className="mt-2 text-sm text-muted-foreground">
              Régime : {profile.recommended_regime || "—"}
              {profile.tax_category ? ` (${profile.tax_category})` : ""}
              {profile.regime_plafond ? ` — ${profile.regime_plafond}` : ""}
            </p>
          )}
        </Card>
      )}

      {(expert || profile.fiscal_classification_status === "requires_expert") && (
        <Card className="border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <LifeBuoy className="mt-0.5 size-5 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Classification bloquée — incohérence détectée</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {profile.fiscal_inconsistency_reason ||
                  "Contactez votre SIE ou demandez un rescrit fiscal via impots.gouv.fr."}
              </p>
            </div>
          </div>
        </Card>
      )}

      {profile.activity_mismatch && (profile.mismatches?.length ?? 0) > 0 && (
        <Card className="border-warning/40 bg-warning/10 p-5">
          <p className="font-semibold">Écart d'activité détecté</p>
          {profile.mismatches?.map((m, i) => (
            <p key={i} className="mt-1 text-sm text-muted-foreground">
              {m.note}
            </p>
          ))}
        </Card>
      )}

      <Card className="divide-y divide-border overflow-hidden">
        <FieldRow
          label="Types d'activité"
          action={
            <EditButton
              active={editingField === "activity_types"}
              disabled={saving}
              onClick={() =>
                editingField === "activity_types"
                  ? setEditingField(null)
                  : setEditingField("activity_types")
              }
            />
          }
        >
          {editingField === "activity_types" ? (
            <Input
              autoFocus
              disabled={saving}
              defaultValue={asList(profile.activity_types).join(", ")}
              placeholder="Sponsoring, Affiliation, UGC…"
              onBlur={(e) => {
                const items = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                void commit({ activity_types: items });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <ChipRow items={asList(profile.activity_types)} />
          )}
        </FieldRow>

        <FieldRow
          label="Sources de revenus / Plateformes"
          action={
            <EditButton
              active={editingField === "revenue_sources"}
              disabled={saving}
              onClick={() =>
                editingField === "revenue_sources"
                  ? setEditingField(null)
                  : setEditingField("revenue_sources")
              }
            />
          }
        >
          {editingField === "revenue_sources" ? (
            <Input
              autoFocus
              disabled={saving}
              defaultValue={asList(profile.revenue_sources).join(", ")}
              placeholder="YouTube, Instagram, TikTok…"
              onBlur={(e) => {
                const items = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                void commit({ revenue_sources: items });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <ChipRow items={asList(profile.revenue_sources)} tone="neutral" />
          )}
        </FieldRow>

        <FieldRow
          label="Devises de paiement"
          action={
            <EditButton
              active={editingField === "currencies"}
              disabled={saving}
              onClick={() =>
                editingField === "currencies" ? setEditingField(null) : setEditingField("currencies")
              }
            />
          }
        >
          {editingField === "currencies" ? (
            <Input
              autoFocus
              disabled={saving}
              defaultValue={asList(profile.currencies).join(", ")}
              placeholder="EUR, USD…"
              onBlur={(e) => {
                const items = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                void commit({ currencies: items });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <ChipRow items={asList(profile.currencies)} tone="success" />
          )}
        </FieldRow>

        <FieldRow
          label="Clients internationaux"
          action={
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void commit({
                  international_clients: profile.international_clients === true ? false : true,
                })
              }
              className="text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Changer
            </button>
          }
        >
          <p className="text-sm font-medium">
            {profile.international_clients === null || profile.international_clients === undefined
              ? "Non précisé"
              : profile.international_clients
                ? "Oui (factures hors France / UE)"
                : "Non (France uniquement)"}
          </p>
        </FieldRow>

        <FieldRow
          label="Revenu mensuel estimé"
          action={
            <EditButton
              active={editingField === "estimated_monthly_revenue"}
              disabled={saving}
              onClick={() =>
                editingField === "estimated_monthly_revenue"
                  ? setEditingField(null)
                  : setEditingField("estimated_monthly_revenue")
              }
            />
          }
        >
          {editingField === "estimated_monthly_revenue" ? (
            <Input
              autoFocus
              disabled={saving}
              defaultValue={profile.estimated_monthly_revenue ?? ""}
              placeholder="Ex. 2 500 €"
              onBlur={(e) => void commit({ estimated_monthly_revenue: e.target.value.trim() || null })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <p className="text-sm font-semibold">
              {profile.estimated_monthly_revenue || (
                <span className="italic font-normal text-muted-foreground">Non renseigné</span>
              )}
            </p>
          )}
        </FieldRow>

        <FieldRow label="Stabilité des revenus">
          <div className="flex flex-wrap gap-2 pt-1">
            {(["stable", "spiky"] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={saving}
                onClick={() => void commit({ revenue_variability: v })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  profile.revenue_variability === v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground",
                )}
              >
                {v === "stable" ? "Stables" : "Irréguliers"}
              </button>
            ))}
          </div>
        </FieldRow>

        <FieldRow
          label="Factures déjà émises"
          action={
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void commit({
                  invoices_already_issued: profile.invoices_already_issued === true ? false : true,
                })
              }
              className="text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Changer
            </button>
          }
        >
          <p className="text-sm font-medium">
            {profile.invoices_already_issued == null
              ? "Non précisé"
              : profile.invoices_already_issued
                ? "Oui"
                : "Non"}
          </p>
        </FieldRow>

        <FieldRow
          label="Contrats récurrents"
          action={
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void commit({
                  has_recurring_contracts: profile.has_recurring_contracts === true ? false : true,
                })
              }
              className="text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Changer
            </button>
          }
        >
          <p className="text-sm font-medium">
            {profile.has_recurring_contracts == null
              ? "Non précisé"
              : profile.has_recurring_contracts
                ? "Oui (abonnements / retainers)"
                : "Non (one-shot / par mission)"}
          </p>
        </FieldRow>

        <FieldRow
          label="Cadeaux & dotations en nature"
          action={
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void commit({ in_kind_gifts: profile.in_kind_gifts === true ? false : true })
              }
              className="text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Changer
            </button>
          }
        >
          <p className="text-sm font-medium">
            {profile.in_kind_gifts == null
              ? "Non précisé"
              : profile.in_kind_gifts
                ? "Oui (produits, voyages, dotations)"
                : "Non"}
          </p>
        </FieldRow>

        <FieldRow
          label="Début des premiers revenus"
          action={
            <EditButton
              active={editingField === "first_income_date"}
              disabled={saving}
              onClick={() =>
                editingField === "first_income_date"
                  ? setEditingField(null)
                  : setEditingField("first_income_date")
              }
            />
          }
        >
          {editingField === "first_income_date" ? (
            <Input
              autoFocus
              disabled={saving}
              defaultValue={profile.first_income_date ?? ""}
              placeholder="Ex. janvier 2024"
              onBlur={(e) => void commit({ first_income_date: e.target.value.trim() || null })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <p className="text-sm font-semibold">
              {profile.first_income_date || (
                <span className="italic font-normal text-muted-foreground">Non renseigné</span>
              )}
            </p>
          )}
        </FieldRow>
      </Card>

      {saving && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> Enregistrement et recalcul du régime…
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="safran" disabled={confirming || saving} onClick={onConfirm} className="min-w-56">
          {confirming ? (
            <Spinner />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Confirmer mon profil et continuer vers mon dashboard
        </Button>
        {(expert || profile.fiscal_classification_status === "requires_expert") && (
          <ButtonLink to="/referral" variant="outline">
            Contacter des cabinets
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
