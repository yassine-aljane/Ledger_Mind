import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Download,
  ExternalLink,
  Eye,
  FileWarning,
  Loader2,
  MessageSquare,
  ScanLine,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/lm/Markdown";
import { cn } from "@/lib/utils";
import {
  fetchCaptureDocument,
  fetchCaptureDocumentFile,
  formatMoney,
  type CaptureDocumentDetail,
} from "@/lib/api";

type Props = {
  documentId: string;
  /** Ouvre la discussion attachée au document. */
  onChat?: (label: string) => void;
};

type Row = { label: string; value: React.ReactNode; empty: boolean; alert?: boolean };

/** `—` grisé pour un champ absent : l'extraction n'invente rien (FR-08). */
function Empty() {
  return <span className="text-muted-foreground/50">—</span>;
}

function text(value: string | null | undefined): { node: React.ReactNode; empty: boolean } {
  if (!value) return { node: <Empty />, empty: true };
  return { node: value, empty: false };
}

/** `2026-02-12` -> `12/02/2026`. Laisse passer tel quel ce qui n'est pas une date ISO. */
function frDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function money(
  amount: number | null | undefined,
  currency?: string | null,
  amountEur?: number | null,
): { node: React.ReactNode; empty: boolean } {
  if (amount == null) return { node: <Empty />, empty: true };
  const cur = currency ?? "EUR";
  return {
    empty: false,
    node: (
      <span className="num">
        {formatMoney(amount)} {cur}
        {amountEur != null && cur !== "EUR" && (
          <span className="ml-2 text-xs text-muted-foreground">≈ {formatMoney(amountEur)} €</span>
        )}
      </span>
    ),
  };
}

function row(label: string, v: { node: React.ReactNode; empty: boolean }, alert = false): Row {
  return { label, value: v.node, empty: v.empty, alert };
}

/** Amorce de mise en garde que le commentaire isole souvent en fin de texte. */
const CAUTION =
  /(?:\*{1,2})?\s*(points?\s+(?:de\s+vigilance|d['’]attention)|à\s+noter|a\s+noter)\s*(?:\*{1,2})?\s*:\s*/i;

/**
 * Découpe le commentaire rédigé en un corps et une mise en garde.
 *
 * Il arrive en markdown (`**gras**`, `*italique*`) : affiché tel quel, il
 * montrerait ses astérisques. Il s'ouvre en outre presque toujours sur un
 * rappel d'en-tête — « Analyse de la facture n°… » — que la fiche affiche
 * déjà juste au-dessus. Les deux repères sont heuristiques : si l'un manque,
 * le texte passe entier dans le corps.
 */
function splitAnalysis(raw: string): { body: string; caution: string | null } {
  let text = raw.trim();

  const lead = /^\*\*([^*]+)\*\*\s*/.exec(text);
  if (lead && /analyse|facture|virement/i.test(lead[1])) {
    text = text.slice(lead[0].length).trim();
  }

  const marker = CAUTION.exec(text);
  if (marker && marker.index > 0) {
    return {
      body: text.slice(0, marker.index).trim(),
      caution: text.slice(marker.index + marker[0].length).trim(),
    };
  }
  return { body: text, caution: null };
}

/**
 * Chiffre de tête. Chasse proportionnelle volontaire : `tabular-nums` donne à
 * chaque chiffre la largeur d'un « 0 », ce qui fait bâiller un montant à cette
 * taille. La chasse tabulaire est réservée aux colonnes alignées.
 */
function Hero({
  label,
  amount,
  currency,
  amountEur,
  rate,
  rateDate,
  rateSource,
}: {
  label: string;
  amount: number | null | undefined;
  currency?: string | null;
  amountEur?: number | null;
  rate?: number | null;
  rateDate?: string | null;
  rateSource?: string | null;
}) {
  const cur = currency ?? "EUR";
  const etranger = amount != null && cur !== "EUR";
  return (
    // `flex-1 min-w-0` : sans cela, la légende de conversion élargit le bloc et
    // repousse la pastille d'état à la ligne suivante, où elle paraît orpheline.
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-4xl font-semibold tracking-tight proportional-nums sm:text-5xl">
        {amount != null ? formatMoney(amount) : "—"}
        {amount != null && (
          <span className="ml-2 align-baseline text-lg font-medium text-muted-foreground">
            {cur}
          </span>
        )}
      </p>

      {/* Contre-valeur en euros, sous le montant tel qu'il figure sur la pièce.
          C'est le chiffre qui sert à la comptabilité française : il doit se lire
          sans effort, pas se deviner dans une légende. */}
      {etranger && amountEur != null && (
        <>
          <p className="mt-1.5 font-mono text-xl font-medium proportional-nums text-foreground">
            = {formatMoney(amountEur)} <span className="text-base">EUR</span>
          </p>
          <p className="num mt-1 text-xs text-muted-foreground">
            taux {rate != null ? rate.toLocaleString("fr-FR", { maximumFractionDigits: 6 }) : "—"}
            {rateDate ? ` du ${frDate(rateDate)}` : ""}
            {rateSource ? ` · source ${rateSource}` : ""}
          </p>
        </>
      )}

      {/* Une devise non convertible doit se voir : sans cela, le montant en
          euros paraîtrait simplement oublié. */}
      {etranger && amountEur == null && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Contre-valeur en euros indisponible pour cette devise.
        </p>
      )}
    </div>
  );
}

/** Une tuile de la rangée sous le chiffre de tête. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-0.5 truncate text-sm font-medium">{children}</p>
    </div>
  );
}

/** Pastille d'état : couleur toujours accompagnée d'une icône et d'un libellé. */
function StatePill({
  tone,
  icon: Icon,
  children,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tone === "success" && "border-success/30 bg-success/12 text-success-ink",
        tone === "warning" && "border-warning/40 bg-warning/15 text-warning-ink",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "neutral" && "border-border bg-secondary/60 text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

function Section({
  title,
  rows,
  hideEmpty,
}: {
  title: string;
  rows: Row[];
  hideEmpty: boolean;
}) {
  const visible = hideEmpty ? rows.filter((r) => !r.empty) : rows;
  if (visible.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="rule-label text-accent-ink">{title}</h4>
      <dl className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {visible.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 px-3 py-2 text-sm odd:bg-secondary/30"
          >
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn("min-w-0 break-words font-medium", r.alert && "text-destructive")}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Aperçu de la pièce : PDF, image, ou repli sur le texte OCR. */
function Preview({ detail }: { detail: CaptureDocumentDetail }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!detail.has_file) {
      setUrl(null);
      setState("idle");
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setState("loading");
    fetchCaptureDocumentFile(detail.document_id)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
        setState("idle");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      // L'URL objet retient le blob en mémoire tant qu'elle n'est pas révoquée.
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [detail.document_id, detail.has_file]);

  const isPdf =
    (detail.mime ?? "").includes("pdf") || (detail.filename ?? "").toLowerCase().endsWith(".pdf");

  if (state === "loading") {
    return (
      <div className="grid h-full min-h-80 place-items-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (detail.has_file && url && state !== "error") {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-border bg-secondary/40">
          {isPdf ? (
            <iframe
              src={url}
              title={detail.filename ?? "Document"}
              className="h-[32rem] w-full border-0 bg-white"
            />
          ) : (
            <img
              src={url}
              alt={detail.filename ?? "Document"}
              className="mx-auto max-h-[32rem] w-auto max-w-full object-contain"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Plein écran
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={url} download={detail.filename ?? "document"}>
              <Download /> Télécharger
            </a>
          </Button>
        </div>
      </div>
    );
  }

  // Repli : les documents analysés avant la conservation des pièces n'ont que leur texte OCR.
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/12 px-4 py-3 text-sm text-warning-ink">
        <FileWarning className="mt-0.5 size-4 shrink-0" />
        <p>
          {state === "error"
            ? "La pièce d'origine n'a pas pu être chargée."
            : "Pièce d'origine non conservée pour ce document — voici le texte lu à la lecture optique."}
        </p>
      </div>
      {detail.ocr_text ? (
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {detail.ocr_text}
        </pre>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aucun texte disponible.
        </p>
      )}
    </div>
  );
}

/**
 * Consultation d'un document déjà traité : la pièce d'origine d'un côté,
 * sa fiche de l'autre.
 *
 * La fiche s'ouvre sur les montants, puis les contrôles automatiques, et ne
 * place le commentaire rédigé qu'en fin de parcours : c'est une pièce
 * comptable qu'on consulte, pas une réponse de machine qu'on lit.
 */
export function DocumentInspector({ documentId, onChat }: Props) {
  const [detail, setDetail] = useState<CaptureDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCaptureDocument(documentId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Document introuvable.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const label = useMemo(() => {
    if (!detail) return "Document";
    if (detail.document_type === "virement") {
      const t = detail.transfer;
      return t?.direction === "emis"
        ? (t?.beneficiary_name ?? "Virement émis")
        : (t?.sender_name ?? "Virement reçu");
    }
    if (detail.document_type === "contrat") {
      const c = detail.contract;
      return (
        c?.title ??
        (c?.parties ?? []).find((p) => p.name)?.name ??
        (c?.contract_type ? `Contrat de ${c.contract_type}` : "Contrat")
      );
    }
    return detail.invoice?.issuer_name ?? "Facture";
  }, [detail]);

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-border bg-card shadow-soft">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/30 bg-destructive/8 p-5 text-sm font-medium text-destructive"
      >
        {error ?? "Document introuvable."}
      </div>
    );
  }

  const isVirement = detail.document_type === "virement";
  const isContrat = detail.document_type === "contrat";
  const inv = detail.invoice;
  const tr = detail.transfer;
  const ct = detail.contract;

  // Un IBAN signalé par un contrôle est mis en évidence dans la fiche.
  const flagged = (value: string | null | undefined) =>
    Boolean(value && detail.incoherences?.some((i) => i.includes(value)));

  const days = detail.payment_days_until;
  const echeance = frDate(inv?.due_date ?? detail.payment_date);

  /** Jours avant l'échéance du contrat ; négatif s'il est déjà échu. */
  const joursRestants = (() => {
    if (!ct?.end_date) return null;
    const fin = new Date(`${ct.end_date}T00:00:00`);
    if (Number.isNaN(fin.getTime())) return null;
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    return Math.round((fin.getTime() - aujourdhui.getTime()) / 86_400_000);
  })();
  const synthese = detail.analysis ? splitAnalysis(detail.analysis) : null;

  const sections: { title: string; rows: Row[] }[] = isContrat
    ? [
        {
          title: "Contrat",
          rows: [
            row("Nature", {
              node: ct?.contract_type ? (
                <span className="capitalize">{ct.contract_type}</span>
              ) : (
                <Empty />
              ),
              empty: !ct?.contract_type,
            }),
            row("Intitulé", text(ct?.title)),
            row("Référence", text(ct?.reference)),
            row("Signé le", text(frDate(ct?.signature_date))),
            row("Prise d'effet", text(frDate(ct?.start_date))),
            row(
              "Échéance",
              text(ct?.is_open_ended ? "Durée indéterminée" : frDate(ct?.end_date)),
            ),
            row(
              "Durée",
              text(ct?.duration_months != null ? `${ct.duration_months} mois` : null),
            ),
          ],
        },
        {
          title: "Conditions",
          rows: [
            row("Contrepartie", money(ct?.amount, ct?.currency, ct?.amount_eur)),
            row("Versement", text(ct?.payment_schedule)),
            row(
              "Préavis",
              text(ct?.notice_period_days != null ? `${ct.notice_period_days} jours` : null),
            ),
            row("Reconduction", text(ct?.renewal)),
            row("Droit applicable", text(ct?.jurisdiction)),
          ],
        },
      ]
    : isVirement
    ? [
        {
          title: "Opération",
          rows: [
            row("Référence", text(tr?.transfer_reference)),
            row("Date d'exécution", text(frDate(tr?.execution_date))),
            row("Date de valeur", text(frDate(tr?.value_date))),
            row("Type", text(tr?.transfer_type)),
            row("Motif", text(tr?.motif)),
          ],
        },
        {
          title: "Comptes",
          rows: [
            row("Émetteur", text(tr?.sender_name)),
            row(
              "IBAN émetteur",
              {
                node: tr?.sender_iban ? (
                  <span className="num text-xs break-all">{tr.sender_iban}</span>
                ) : (
                  <Empty />
                ),
                empty: !tr?.sender_iban,
              },
              flagged(tr?.sender_iban),
            ),
            row("Bénéficiaire", text(tr?.beneficiary_name)),
            row(
              "IBAN bénéficiaire",
              {
                node: tr?.beneficiary_iban ? (
                  <span className="num text-xs break-all">{tr.beneficiary_iban}</span>
                ) : (
                  <Empty />
                ),
                empty: !tr?.beneficiary_iban,
              },
              flagged(tr?.beneficiary_iban),
            ),
            row("BIC", text(tr?.beneficiary_bic)),
            row("Banque", text(tr?.bank_name)),
          ],
        },
      ]
    : [
        {
          title: "Identité",
          rows: [
            row("Émetteur", text(inv?.issuer_name)),
            row("Matricule fiscal", text(inv?.issuer_tax_id)),
            row("Client", text(inv?.client_name)),
            row("N° de facture", text(inv?.invoice_number)),
            row("Date d'émission", text(frDate(inv?.issue_date))),
          ],
        },
        {
          title: "Règlement",
          rows: [
            row("Échéance", text(echeance)),
            row(
              "Délai accordé",
              text(inv?.payment_terms_days != null ? `${inv.payment_terms_days} jours` : null),
            ),
            // Le taux et sa provenance sont portés par le bandeau chiffré, au
            // contact du montant qu'ils convertissent — pas répétés ici.
          ],
        },
      ];

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={isVirement ? "info" : isContrat ? "warning" : "success"}>
            {isVirement ? "Virement" : isContrat ? "Contrat" : "Facture"}
          </Badge>
          <h2 className="truncate text-lg">{label}</h2>
        </div>
        {onChat && (
          <Button variant="outline" size="sm" onClick={() => onChat(label)}>
            <MessageSquare /> Poser une question
          </Button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* La fiche est bien plus haute que l'aperçu : on garde la pièce sous les
            yeux pendant qu'on parcourt les montants. */}
        <div className="space-y-3 xl:sticky xl:top-24 xl:self-start">
          <h3 className="rule-label text-muted-foreground">Aperçu</h3>
          <Preview detail={detail} />
          {detail.filename && (
            <p className="truncate text-xs text-muted-foreground" title={detail.filename}>
              {detail.filename}
              {detail.detected_language && detail.detected_language !== "fr" && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <ScanLine className="inline size-3" />
                  traduit depuis « {detail.detected_language} »
                </span>
              )}
            </p>
          )}
        </div>

        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="rule-label text-muted-foreground">Fiche</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="size-3.5 accent-current"
              />
              Masquer les champs vides
            </label>
          </div>

          {/* Bandeau chiffré : la pièce s'annonce par ses montants, pas par du texte. */}
          <div className="rounded-2xl border border-border bg-secondary/30 p-5">
            <div className="flex items-start justify-between gap-3">
              {isContrat ? (
                <Hero
                  label="Contrepartie"
                  amount={ct?.amount}
                  currency={ct?.currency}
                  amountEur={ct?.amount_eur}
                  rate={ct?.exchange_rate}
                  rateDate={ct?.rate_date}
                  rateSource={ct?.rate_source}
                />
              ) : isVirement ? (
                <Hero
                  label="Montant"
                  amount={tr?.amount}
                  currency={tr?.currency}
                  amountEur={tr?.amount_eur}
                  rate={tr?.exchange_rate}
                  rateDate={tr?.rate_date}
                  rateSource={tr?.rate_source}
                />
              ) : (
                <Hero
                  label="Total TTC"
                  amount={inv?.total_ttc}
                  currency={inv?.currency}
                  amountEur={inv?.amount_eur}
                  rate={inv?.exchange_rate}
                  rateDate={inv?.rate_date}
                  rateSource={inv?.rate_source}
                />
              )}

              {isContrat ? (
                joursRestants != null && joursRestants < 0 ? (
                  <StatePill tone="neutral" icon={CircleDashed}>
                    Échu depuis {Math.abs(joursRestants)} j
                  </StatePill>
                ) : joursRestants != null ? (
                  <StatePill tone="warning" icon={CalendarClock}>
                    Fin dans {joursRestants} j
                  </StatePill>
                ) : ct?.is_open_ended ? (
                  <StatePill tone="success" icon={CheckCircle2}>
                    Durée indéterminée
                  </StatePill>
                ) : (
                  <StatePill tone="neutral" icon={CircleDashed}>
                    Durée non précisée
                  </StatePill>
                )
              ) : isVirement ? (
                tr?.direction === "emis" ? (
                  <StatePill tone="neutral" icon={CircleDashed}>
                    Virement émis
                  </StatePill>
                ) : tr?.direction === "recu" ? (
                  <StatePill tone="success" icon={CheckCircle2}>
                    Virement reçu
                  </StatePill>
                ) : null
              ) : detail.paid === true ? (
                <StatePill tone="success" icon={CheckCircle2}>
                  Réglée
                </StatePill>
              ) : detail.paid === false ? (
                days != null && days < 0 ? (
                  <StatePill tone="danger" icon={AlertTriangle}>
                    En retard de {Math.abs(days)} j
                  </StatePill>
                ) : (
                  <StatePill tone="warning" icon={CalendarClock}>
                    {days != null ? `À régler sous ${days} j` : "Non réglée"}
                  </StatePill>
                )
              ) : (
                <StatePill tone="neutral" icon={CircleDashed}>
                  Règlement inconnu
                </StatePill>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/70 pt-4 sm:grid-cols-3">
              {isContrat ? (
                <>
                  <Stat label="Prise d'effet">{frDate(ct?.start_date) ?? <Empty />}</Stat>
                  <Stat label="Échéance">
                    {ct?.is_open_ended ? "Indéterminée" : (frDate(ct?.end_date) ?? <Empty />)}
                  </Stat>
                  <Stat label="Versement">{ct?.payment_schedule ?? <Empty />}</Stat>
                </>
              ) : isVirement ? (
                <>
                  <Stat label="Exécuté le">{frDate(tr?.execution_date) ?? <Empty />}</Stat>
                  <Stat label="Type">{tr?.transfer_type ?? <Empty />}</Stat>
                  <Stat label="Référence">{tr?.transfer_reference ?? <Empty />}</Stat>
                </>
              ) : (
                <>
                  <Stat label="Sous-total HT">
                    {inv?.subtotal_ht != null ? (
                      `${formatMoney(inv.subtotal_ht)} ${inv.currency ?? "EUR"}`
                    ) : (
                      <Empty />
                    )}
                  </Stat>
                  <Stat label="TVA">
                    {inv?.vat_amount != null ? (
                      `${formatMoney(inv.vat_amount)} ${inv.currency ?? "EUR"}`
                    ) : (
                      <Empty />
                    )}
                  </Stat>
                  <Stat label="Émise le">{frDate(inv?.issue_date) ?? <Empty />}</Stat>
                </>
              )}
            </div>

            {!isVirement && !isContrat && detail.expense_category && (
              <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-4">
                <span className="text-xs text-muted-foreground">Poste de dépense</span>
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium capitalize">
                  {detail.expense_category}
                </span>
              </div>
            )}

            {isContrat && ct?.contract_type && (
              <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-4">
                <span className="text-xs text-muted-foreground">Nature</span>
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium capitalize">
                  {ct.contract_type}
                </span>
              </div>
            )}
          </div>

          {/* Contrôles déterministes — des vérifications de cohérence, pas un avis. */}
          {detail.incoherences && (
            <section className="space-y-2">
              <h4 className="rule-label text-accent-ink">Contrôles</h4>
              {detail.incoherences.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success-ink">
                  <ShieldCheck className="size-4 shrink-0" />
                  Aucune anomalie détectée sur cette pièce.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-warning/40">
                  {detail.incoherences.map((inc, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 bg-warning/10 px-3 py-2.5 text-sm text-warning-ink"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>{inc}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Les parties passent AVANT les autres sections : sur un contrat,
              savoir qui s'engage prime sur les conditions. */}
          {isContrat && ct?.parties && ct.parties.length > 0 && (
            <section className="space-y-2">
              <h4 className="rule-label text-accent-ink">Parties signataires</h4>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                {ct.parties.map((p, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-2.5 text-sm odd:bg-secondary/30">
                    <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium">{p.name ?? <Empty />}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.role ?? "rôle non précisé"}
                        {p.identifier && <span className="num ml-2">{p.identifier}</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sections.map((s) => (
            <Section key={s.title} title={s.title} rows={s.rows} hideEmpty={hideEmpty} />
          ))}

          {isContrat && ct?.obligations && ct.obligations.length > 0 && (
            <section className="space-y-2">
              <h4 className="rule-label text-accent-ink">Engagements clés</h4>
              <ul className="space-y-1.5">
                {ct.obligations.map((o, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 text-muted-foreground">{o}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isVirement && inv?.line_items && inv.line_items.length > 0 && (
            <section className="space-y-2">
              <h4 className="rule-label text-accent-ink">Détail des lignes</h4>
              {/* Colonnes de chiffres : ici la chasse tabulaire est la bonne. */}
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-secondary/40 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-normal">Désignation</th>
                      <th className="px-3 py-2 text-right font-normal">Qté</th>
                      <th className="px-3 py-2 text-right font-normal">P.U.</th>
                      <th className="px-3 py-2 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {inv.line_items.map((li, i) => (
                      <tr key={i} className="odd:bg-secondary/20">
                        {/* Seule la désignation se replie : un montant coupé en
                            deux lignes devient illisible dans une colonne. */}
                        <td className="px-3 py-2">{li.description ?? <Empty />}</td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                          {li.quantity ?? "—"}
                        </td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                          {li.unit_price != null ? formatMoney(li.unit_price) : "—"}
                        </td>
                        <td className="num px-3 py-2 text-right font-medium whitespace-nowrap">
                          {li.total != null ? formatMoney(li.total) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Commentaire rédigé, en fin de fiche et en retrait : une note de bas
              de page, pas le sujet principal. */}
          {synthese && (synthese.body || synthese.caution) && (
            <section className="space-y-3">
              <h4 className="rule-label text-accent-ink">Synthèse</h4>

              {synthese.body && (
                <Markdown
                  text={synthese.body}
                  className="border-l-2 border-border pl-4 text-sm text-muted-foreground"
                />
              )}

              {/* Teinte neutre à dessein : les couleurs de signal restent
                  réservées aux contrôles déterministes ci-dessus. Un conseil
                  rédigé ne doit pas se donner l'allure d'une anomalie avérée. */}
              {synthese.caution && (
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/50 px-3.5 py-3">
                  <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 space-y-1">
                    <p className="rule-label text-muted-foreground">Point de vigilance</p>
                    <Markdown text={synthese.caution} className="text-sm text-muted-foreground" />
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
