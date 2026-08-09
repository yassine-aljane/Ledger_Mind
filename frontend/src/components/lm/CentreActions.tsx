import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  fetchCaptureInvoices,
  fetchCaptureVirements,
  formatMoney,
  type CaptureInvoiceItem,
  type CaptureVirementItem,
} from "@/lib/api";
import {
  fetchFilVeille,
  fetchNotificationsVeille,
  lancerCollecteVeille,
  majPreferencesVeille,
  marquerToutVeilleLu,
  type Nouveaute,
  type PreferencesVeille,
  type StatsCatalogue,
} from "@/lib/veille-api";
import { usePlan } from "@/lib/plan";
import { cn } from "@/lib/utils";
import {
  fetchAgenda,
  fetchHistorique,
  marquerPaye,
  mettreAJourParametres,
  type AgendaResponse,
  type Echeance,
  type HistoriqueItem,
} from "@/lib/echeancier-api";

type Vue = "agenda" | "veille" | "historique";

/** Signal « le compteur a changé » — la vue Veille l'émet, la cloche l'écoute. */
const EVT_VEILLE_LUE = "lm.veille.lue";

const COULEUR_STATUT: Record<Echeance["statut"], string> = {
  en_retard: "bg-destructive",
  urgent: "bg-warning",
  regularisee: "bg-success",
  a_venir: "bg-muted-foreground/40",
};

const LABEL_STATUT: Record<Echeance["statut"], string> = {
  en_retard: "En retard",
  urgent: "Approche",
  regularisee: "Réglée",
  a_venir: "À venir",
};

const VARIANTE_STATUT: Record<
  Echeance["statut"],
  "destructive" | "warning" | "success" | "outline"
> = {
  en_retard: "destructive",
  urgent: "warning",
  regularisee: "success",
  a_venir: "outline",
};

function libelleBouton(e: Echeance): string {
  if (e.statut === "regularisee") return "Voir le justificatif";
  if (e.fenetre_indicative && !e.date_limite) return "Préparer";
  return "Déclarer et payer";
}

function EcheanceCard({ e, onMarquerPaye }: { e: Echeance; onMarquerPaye: (e: Echeance) => void }) {
  return (
    <div className="card-hover space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", COULEUR_STATUT[e.statut])} />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-medium">{e.libelle}</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {e.date_limite
                ? `Avant le ${new Date(e.date_limite).toLocaleDateString("fr-FR")}`
                : e.fenetre_indicative}
              {" · "}
              {e.periode}
            </p>
          </div>
        </div>
        <Badge variant={VARIANTE_STATUT[e.statut]} className="shrink-0">
          {LABEL_STATUT[e.statut]}
        </Badge>
      </div>
      {e.statut !== "regularisee" && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={e.portail_paiement} target="_blank" rel="noreferrer">
              {libelleBouton(e)} — {e.portail_label}
            </a>
          </Button>
          <Button size="sm" variant="outline" onClick={() => onMarquerPaye(e)}>
            <Check /> Marquer comme payé
          </Button>
        </div>
      )}
      <p className="text-[0.8125rem] text-muted-foreground/70">Source : {e.source}</p>
    </div>
  );
}

function FormulaireParametres({
  manquants,
  onEnregistre,
}: {
  manquants: string[];
  onEnregistre: () => void;
}) {
  const [periodicite, setPeriodicite] = useState<"mensuelle" | "trimestrielle">("mensuelle");
  const [regimeTva, setRegimeTva] = useState<"franchise" | "reel_simplifie" | "reel_normal">(
    "franchise",
  );
  const [clientsUe, setClientsUe] = useState(false);
  const [loading, setLoading] = useState(false);

  async function enregistrer() {
    setLoading(true);
    try {
      const valeurs: Record<string, unknown> = {};
      if (manquants.includes("periodicite_urssaf")) valeurs.periodicite_urssaf = periodicite;
      if (manquants.includes("regime_tva")) valeurs.regime_tva = regimeTva;
      if (manquants.includes("revenus_intracommunautaires"))
        valeurs.revenus_intracommunautaires = clientsUe;
      await mettreAJourParametres(valeurs);
      onEnregistre();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-rise space-y-4 rounded-2xl border border-accent/40 bg-accent/10 p-5">
      <p className="text-[0.9375rem] font-medium">
        Quelques informations pour affiner votre agenda (demandées une seule fois) :
      </p>
      {manquants.includes("periodicite_urssaf") && (
        <div>
          <label htmlFor="ca-periodicite" className="rule-label-lg text-label-ink">
            Périodicité URSSAF
          </label>
          <select
            id="ca-periodicite"
            value={periodicite}
            onChange={(e) => setPeriodicite(e.target.value as typeof periodicite)}
            className="input-boxed mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[0.9375rem]"
          >
            <option value="mensuelle">Mensuelle</option>
            <option value="trimestrielle">Trimestrielle</option>
          </select>
        </div>
      )}
      {manquants.includes("regime_tva") && (
        <div>
          <label htmlFor="ca-tva" className="rule-label-lg text-label-ink">
            Régime de TVA
          </label>
          <select
            id="ca-tva"
            value={regimeTva}
            onChange={(e) => setRegimeTva(e.target.value as typeof regimeTva)}
            className="input-boxed mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[0.9375rem]"
          >
            <option value="franchise">Franchise en base (pas de TVA)</option>
            <option value="reel_simplifie">Réel simplifié</option>
            <option value="reel_normal">Réel normal</option>
          </select>
        </div>
      )}
      {manquants.includes("revenus_intracommunautaires") && (
        <label className="flex items-start gap-2 text-[0.9375rem]">
          <input
            type="checkbox"
            checked={clientsUe}
            onChange={(e) => setClientsUe(e.target.checked)}
            className="mt-0.5"
          />
          Je facture des clients professionnels établis dans un autre pays de l&apos;UE
        </label>
      )}
      <Button type="button" onClick={enregistrer} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" /> Enregistrement…
          </>
        ) : (
          "Enregistrer"
        )}
      </Button>
    </div>
  );
}

// -------- Calendrier fiscal (vue mensuelle, dates en retard/urgentes en rouge, à venir en orange) --------
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

function grilleMoisCourant(): { jours: (Date | null)[]; label: string } {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = maintenant.getMonth();
  const premierJour = new Date(annee, mois, 1);
  const nbJours = new Date(annee, mois + 1, 0).getDate();
  const decalage = (premierJour.getDay() + 6) % 7; // grille Lundi -> Dimanche
  const jours: (Date | null)[] = Array(decalage).fill(null);
  for (let j = 1; j <= nbJours; j++) jours.push(new Date(annee, mois, j));
  return {
    jours,
    label: premierJour.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
  };
}

/** Rouge = échéance en retard ou urgente (imminente) ; orange = échéance à venir plus loin. */
function couleursParDate(echeances: Echeance[]): Record<string, "rouge" | "orange"> {
  const map: Record<string, "rouge" | "orange"> = {};
  for (const e of echeances) {
    if (!e.date_limite) continue;
    const cle = e.date_limite.slice(0, 10);
    if (e.statut === "en_retard" || e.statut === "urgent") map[cle] = "rouge";
    else if (e.statut === "a_venir" && map[cle] !== "rouge") map[cle] = "orange";
  }
  return map;
}

// -------- Documents déposés, épinglés au calendrier --------
/**
 * Une pièce déposée (facture ou virement) reportée sur le calendrier, à SA date.
 *
 * Ces repères ne sont pas des obligations légales : une facture à régler est un engagement
 * commercial, pas une échéance URSSAF ou TVA. Ils portent donc un marquage distinct (pastille
 * sous le quantième, jamais la pastille pleine des obligations) pour qu'on ne puisse pas
 * confondre les deux natures d'un simple coup d'œil.
 */
type DocumentEcheance = {
  id: string;
  date: string; // ISO court (AAAA-MM-JJ)
  kind: "facture" | "virement";
  /** `a_regler` = facture impayée à venir ; `en_retard` = impayée dont la date est passée ;
   *  `archive` = facture réglée ou virement déjà exécuté (repère, pas action). */
  etat: "a_regler" | "en_retard" | "archive";
  libelle: string;
  montant: string | null;
};

function montantLisible(
  montant: number | null | undefined,
  devise: string | null | undefined,
  montantEur: number | null | undefined,
): string | null {
  if (montant == null) return null;
  const cur = devise ?? "EUR";
  const base = `${formatMoney(montant)} ${cur}`;
  return montantEur != null && cur !== "EUR" ? `${base} (≈ ${formatMoney(montantEur)} €)` : base;
}

/** Décale une date ISO de `jours` jours (utilisé pour reconstituer une échéance depuis les
 *  conditions de paiement quand la facture ne porte pas de date limite explicite). */
function decalerIso(iso: string, jours: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  d.setDate(d.getDate() + jours);
  return toISODate(d);
}

function documentsVersEcheances(
  factures: CaptureInvoiceItem[],
  virements: CaptureVirementItem[],
): DocumentEcheance[] {
  const aujourdHui = toISODate(new Date());
  const out: DocumentEcheance[] = [];

  for (const f of factures) {
    // Date de référence : l'échéance annoncée, sinon reconstituée depuis les conditions de
    // paiement, sinon la date d'émission. Une facture sans aucune date n'est pas épinglée :
    // la caler sur la date de dépôt donnerait un repère faux dans un calendrier fiscal.
    const inv = f.invoice;
    const date =
      inv.due_date?.slice(0, 10) ||
      (inv.issue_date && inv.payment_terms_days != null
        ? decalerIso(inv.issue_date, inv.payment_terms_days)
        : null) ||
      inv.issue_date?.slice(0, 10) ||
      null;
    if (!date) continue;

    const reglee = (f.paid ?? inv.paid) === true;
    out.push({
      id: `f-${f.document_id}`,
      date,
      kind: "facture",
      etat: reglee ? "archive" : date < aujourdHui ? "en_retard" : "a_regler",
      libelle: inv.issuer_name ?? "Facture",
      montant: montantLisible(inv.total_ttc, inv.currency, inv.amount_eur),
    });
  }

  for (const v of virements) {
    const t = v.transfer;
    const date = t.execution_date?.slice(0, 10) || t.value_date?.slice(0, 10) || null;
    if (!date) continue;
    out.push({
      id: `v-${v.document_id}`,
      date,
      kind: "virement",
      etat: "archive",
      libelle:
        t.direction === "emis"
          ? `Virement émis${t.beneficiary_name ? ` — ${t.beneficiary_name}` : ""}`
          : `Virement reçu${t.sender_name ? ` — ${t.sender_name}` : ""}`,
      montant: montantLisible(t.amount, t.currency, t.amount_eur),
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const PASTILLE_DOCUMENT: Record<DocumentEcheance["etat"], string> = {
  en_retard: "bg-destructive",
  a_regler: "bg-info",
  archive: "bg-muted-foreground/50",
};

function CalendrierFiscal({
  echeances,
  documents,
}: {
  echeances: Echeance[];
  documents: DocumentEcheance[];
}) {
  const { jours, label } = grilleMoisCourant();
  const couleurs = couleursParDate(echeances);
  const aujourdHui = toISODate(new Date());
  const joursDuMois = new Set(jours.filter((j): j is Date => j !== null).map(toISODate));

  const docsParDate = new Map<string, DocumentEcheance[]>();
  for (const d of documents) {
    if (!joursDuMois.has(d.date)) continue;
    const liste = docsParDate.get(d.date);
    if (liste) liste.push(d);
    else docsParDate.set(d.date, [d]);
  }
  const docsDuMois = documents.filter((d) => joursDuMois.has(d.date));
  // La grille ne montre qu'un mois : sans ce repli, une facture à régler datée du mois suivant
  // resterait totalement invisible. Seules les pièces encore actionnables sont reprises ici —
  // les documents archivés n'ont pas à encombrer la vue au-delà de leur mois.
  const docsHorsMois = documents
    .filter((d) => !joursDuMois.has(d.date) && d.etat !== "archive")
    .slice(0, 6);

  const horsMois = echeances
    .filter((e) => e.date_limite && !joursDuMois.has(e.date_limite.slice(0, 10)))
    .filter((e) => e.statut === "en_retard" || e.statut === "urgent" || e.statut === "a_venir")
    .sort((a, b) => (a.date_limite ?? "").localeCompare(b.date_limite ?? ""))
    .slice(0, 6);

  return (
    <div className="animate-rise space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.9375rem] font-medium capitalize">{label}</p>
        <div className="rule-label-lg flex flex-wrap items-center gap-x-3 gap-y-1 text-label-ink">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            En retard / urgent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" />À venir
          </span>
          {docsDuMois.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-info" />
              Document
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["L", "M", "M", "J", "V", "S", "D"].map((j, i) => (
          <span key={i} className="rule-label-lg pb-1 text-center text-label-ink">
            {j}
          </span>
        ))}
        {jours.map((jour, i) => {
          if (!jour) return <span key={i} />;
          const iso = toISODate(jour);
          const couleur = couleurs[iso];
          const docs = docsParDate.get(iso) ?? [];
          const infobulle = [
            iso === aujourdHui ? "Aujourd'hui" : null,
            ...docs.map((d) => `${d.libelle}${d.montant ? ` — ${d.montant}` : ""}`),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={i}
              className={cn(
                "num flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-[0.8125rem] transition-all duration-200",
                couleur === "rouge"
                  ? "bg-destructive font-medium text-destructive-foreground"
                  : couleur === "orange"
                    ? "bg-warning font-medium text-warning-foreground"
                    : iso === aujourdHui
                      ? "border border-ink/40 font-medium text-foreground"
                      : "text-muted-foreground",
              )}
              title={infobulle || undefined}
            >
              <span>{jour.getDate()}</span>
              {/* Les pièces déposées se signalent SOUS le quantième, jamais par un aplat :
                  l'aplat reste réservé aux obligations légales. */}
              <span className="flex h-1 items-center gap-0.5">
                {docs.slice(0, 3).map((d) => (
                  <span
                    key={d.id}
                    className={cn(
                      "size-1 rounded-full",
                      couleur ? "bg-current opacity-70" : PASTILLE_DOCUMENT[d.etat],
                    )}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      {docsDuMois.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="rule-label-lg text-label-ink">Documents du mois</p>
          {docsDuMois.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[0.8125rem]">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", PASTILLE_DOCUMENT[d.etat])}
              />
              <span className="num shrink-0 text-muted-foreground">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString("fr-FR")}
              </span>
              <span
                className={cn(
                  "truncate",
                  d.etat === "archive" ? "text-muted-foreground" : "font-medium text-foreground",
                )}
              >
                {d.libelle}
              </span>
              {d.etat !== "archive" && (
                <Badge
                  variant={d.etat === "en_retard" ? "destructive" : "info"}
                  className="ml-auto shrink-0"
                >
                  {d.etat === "en_retard" ? "En retard" : "À régler"}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {(horsMois.length > 0 || docsHorsMois.length > 0) && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="rule-label-lg text-label-ink">Plus loin</p>
          {horsMois.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  e.statut === "a_venir" ? "bg-warning" : "bg-destructive",
                )}
              />
              <span className="num">{new Date(e.date_limite!).toLocaleDateString("fr-FR")}</span>
              <span className="truncate">— {e.libelle}</span>
            </div>
          ))}
          {docsHorsMois.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", PASTILLE_DOCUMENT[d.etat])} />
              <span className="num">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString("fr-FR")}
              </span>
              <span className="truncate">— {d.libelle}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EtatVide({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-10 text-center text-[0.9375rem] text-muted-foreground">{children}</p>
  );
}

function EtatChargement({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-2 py-10 text-[0.9375rem] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {children}
    </p>
  );
}

function VueAgenda({ onOuvrirHistorique }: { onOuvrirHistorique: () => void }) {
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentEcheance[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function recharger() {
    setLoading(true);
    setErreur(null);
    fetchAgenda()
      .then(setData)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur de chargement."))
      .finally(() => setLoading(false));

    // Les pièces déposées enrichissent le calendrier, elles ne le conditionnent pas : si cet
    // appel échoue, l'agenda fiscal s'affiche quand même, simplement sans les repères documents.
    Promise.all([fetchCaptureInvoices(), fetchCaptureVirements()])
      .then(([factures, virements]) => setDocuments(documentsVersEcheances(factures, virements)))
      .catch(() => setDocuments([]));
  }

  useEffect(recharger, []);

  async function handleMarquerPaye(e: Echeance) {
    await marquerPaye(e.obligation_id, e.periode);
    recharger();
  }

  if (loading) return <EtatChargement>Chargement de l&apos;agenda…</EtatChargement>;

  if (erreur) {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
        <p className="text-[0.9375rem] text-muted-foreground">{erreur}</p>
        <Button asChild>
          <Link to="/onboarding/verification">Vérifier mon SIREN</Link>
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.parametres_manquants.length > 0 && (
        <FormulaireParametres manquants={data.parametres_manquants} onEnregistre={recharger} />
      )}
      <CalendrierFiscal echeances={data.echeances} documents={documents} />
      {data.echeances.length === 0 ? (
        <EtatVide>Aucune échéance applicable à votre profil.</EtatVide>
      ) : (
        data.echeances.map((e) => <EcheanceCard key={e.id} e={e} onMarquerPaye={handleMarquerPaye} />)
      )}
      <button
        type="button"
        onClick={onOuvrirHistorique}
        className="inline-flex w-full items-center justify-center gap-1 pt-2 text-center text-[0.9375rem] font-medium text-primary hover:underline"
      >
        Voir l&apos;historique fiscal complet <ArrowRight className="size-3" />
      </button>
    </div>
  );
}

function VueHistorique({ onRetour }: { onRetour: () => void }) {
  const [items, setItems] = useState<HistoriqueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistorique()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onRetour}
        className="inline-flex items-center gap-1 text-[0.9375rem] font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-3" /> Retour à l&apos;agenda
      </button>
      {loading ? (
        <EtatChargement>Chargement…</EtatChargement>
      ) : items.length === 0 ? (
        <EtatVide>Aucun élément dans l&apos;historique.</EtatVide>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div
              key={`${it.type}-${it.id}`}
              className="card-hover rounded-2xl border border-border bg-card p-4 shadow-soft"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.9375rem] font-medium">{it.libelle}</p>
                <Badge variant="outline" className="shrink-0">
                  {it.statut}
                </Badge>
              </div>
              <p className="num mt-1 text-[0.8125rem] text-muted-foreground">
                {new Date(it.date).toLocaleDateString("fr-FR")}
                {it.montant != null ? ` · ${it.montant.toFixed(2)} €` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const IMPACT_VEILLE: Record<
  Nouveaute["impact"],
  { label: string; variante: "destructive" | "warning" | "outline" }
> = {
  action_obligatoire: { label: "Action obligatoire", variante: "destructive" },
  action_recommandee: { label: "Action recommandée", variante: "warning" },
  information: { label: "Information", variante: "outline" },
};

/** 1 = texte opposable, 2 = source administrative. La presse seule ne peut pas publier ici. */
const AUTORITE_LABEL: Record<number, string> = {
  1: "Texte opposable",
  2: "Source officielle",
  3: "Presse spécialisée",
};

/**
 * Trois âges, trois traitements visuels — c'est tout l'intérêt d'une veille : distinguer d'un
 * coup d'œil ce qui vient de tomber de ce qui traîne depuis un mois.
 *
 *   `nouveau` — notifié et jamais lu à l'arrivée sur l'écran : liseré safran plein + pastille
 *   `recent`  — notifié dans les 7 jours, déjà lu : liseré bleu discret, sans pastille
 *   `ancien`  — le reste : bordure normale
 */
type AgeVeille = "nouveau" | "recent" | "ancien";

const FENETRE_RECENTE_J = 7;

function joursDepuis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

function ageDe(n: Nouveaute, nouveaux: Set<string> | null): AgeVeille {
  if (nouveaux?.has(n.id)) return "nouveau";
  const jours = joursDepuis(n.date_notifiee);
  if (jours !== null && jours <= FENETRE_RECENTE_J) return "recent";
  return "ancien";
}

const BORDURE_AGE: Record<AgeVeille, string> = {
  // Le repère porte sur la BORDURE, pas sur le fond : un aplat coloré rendrait le résumé moins
  // lisible, alors que c'est justement lui qu'on vient lire.
  nouveau: "border-accent/60 shadow-[0_0_0_1px_var(--accent)] ring-1 ring-accent/20",
  recent: "border-info/40",
  ancien: "border-border",
};

function VeilleCard({ n, age = "ancien" }: { n: Nouveaute; age?: AgeVeille }) {
  const impact = IMPACT_VEILLE[n.impact] ?? IMPACT_VEILLE.information;
  const source = n.sources[0];
  return (
    <div
      className={cn(
        "card-hover animate-rise space-y-3 rounded-2xl border bg-card p-5 shadow-soft",
        BORDURE_AGE[age],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={impact.variante}>{impact.label}</Badge>
          {age === "nouveau" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-accent-foreground">
              <Sparkles className="size-2.5" /> Nouveau
            </span>
          )}
          {age === "recent" && (
            <span className="rule-label-lg rounded-full border border-info/40 px-2 py-0.5 text-info-ink">
              Cette semaine
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {n.echeance && (
            <span className="num text-[0.8125rem] text-muted-foreground">
              Avant le {new Date(`${n.echeance}T00:00:00`).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>
      </div>

      <p className="text-[0.9375rem] font-medium">{n.titre}</p>
      {n.resume && <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{n.resume}</p>}

      {/* Pourquoi CETTE personne la voit : sans cette phrase, une veille personnalisée est
          indiscernable d'une lettre d'information générique. */}
      {n.pourquoi_vous && (
        <p className="rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-[0.8125rem] text-info-ink">
          {n.pourquoi_vous}
        </p>
      )}

      {n.perime && (
        <p className="rounded-lg border border-warning/40 bg-warning/12 px-3 py-2 text-[0.8125rem] text-warning-ink">
          Publication ancienne — vérifiez qu'elle est toujours applicable.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <span className="rule-label-lg text-label-ink">
          {source ? `${source.libelle} · ${AUTORITE_LABEL[source.autorite] ?? ""}` : ""}
        </span>
        {source && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-primary hover:underline"
          >
            Voir la source <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Les identifiants repérés comme neufs, mémorisés pour la durée de l'onglet.
 *
 * Sans cette mémoire, le repère « Nouveau » ne survivait pas à une fermeture du panneau : le
 * Sheet démonte son contenu, la photo était reprise à zéro, et comme tout venait d'être marqué
 * lu, plus rien n'apparaissait comme neuf trente secondes après. `sessionStorage` plutôt que
 * `localStorage` : « nouveau depuis que je suis arrivé » n'a pas de sens d'un jour à l'autre.
 */
const CLE_NOUVEAUX = "lm.veille.nouveaux";

function lireNouveauxMemorises(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const brut = window.sessionStorage.getItem(CLE_NOUVEAUX);
    return new Set<string>(brut ? (JSON.parse(brut) as string[]) : []);
  } catch {
    return new Set();
  }
}

function memoriserNouveaux(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLE_NOUVEAUX, JSON.stringify([...ids]));
  } catch {
    /* quota ou mode privé : le repère est un confort, pas une donnée */
  }
}

function VueVeille() {
  const [nouveautes, setNouveautes] = useState<Nouveaute[]>([]);
  const [prefs, setPrefs] = useState<PreferencesVeille | null>(null);
  const [catalogue, setCatalogue] = useState<StatsCatalogue | null>(null);
  const [profilIncomplet, setProfilIncomplet] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecteEnCours, setCollecteEnCours] = useState(false);
  // Ce qui était non lu à l'ARRIVÉE sur l'écran. On le fige : la lecture marque aussitôt tout
  // comme lu côté serveur, si bien que `n.lue` ne peut plus servir à distinguer quoi que ce
  // soit une fois la page affichée. Sans cette photo, le liseré « Nouveau » ne s'afficherait
  // jamais — le compteur et le repère visuel se détruiraient l'un l'autre.
  const [nouveauxIds, setNouveauxIds] = useState<Set<string>>(lireNouveauxMemorises);

  function charger() {
    setLoading(true);
    fetchFilVeille()
      .then((fil) => {
        setNouveautes(fil.nouveautes);
        setPrefs(fil.preferences);
        setCatalogue(fil.catalogue ?? null);
        setProfilIncomplet(Boolean(fil.profil_incomplet));
        setErreur(null);

        const neufs = fil.nouveautes.filter((n) => n.notifiee && !n.lue).map((n) => n.id);
        if (neufs.length > 0) {
          setNouveauxIds((precedent) => {
            const fusion = new Set([...precedent, ...neufs]);
            memoriserNouveaux(fusion);
            return fusion;
          });
          // Une fois la photo prise, et SEULEMENT après, on éteint le compteur — et seulement
          // sur ce qui est réellement affiché.
          marquerToutVeilleLu(neufs)
            .then(() => window.dispatchEvent(new CustomEvent(EVT_VEILLE_LUE)))
            .catch(() => {});
        }
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur de chargement."))
      .finally(() => setLoading(false));
  }

  useEffect(charger, []);

  async function basculer(champ: Partial<PreferencesVeille>) {
    const maj = await majPreferencesVeille(champ);
    setPrefs(maj);
    charger();
  }

  async function collecter() {
    setCollecteEnCours(true);
    try {
      const res = await lancerCollecteVeille();
      toast.success(
        res.nouvelles > 0
          ? `${res.nouvelles} nouveauté${res.nouvelles > 1 ? "s" : ""} collectée${res.nouvelles > 1 ? "s" : ""}`
          : "Collecte terminée — rien de neuf chez les sources officielles.",
      );
      charger();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Collecte impossible.");
    } finally {
      setCollecteEnCours(false);
    }
  }

  if (loading) return <EtatChargement>Chargement de la veille…</EtatChargement>;

  if (erreur) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-[0.9375rem] text-muted-foreground">
        {erreur}
      </div>
    );
  }

  const nonLues = nouveautes.filter((n) => n.notifiee && !n.lue).length;
  const catalogueVide = (catalogue?.actualites ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={prefs?.mode === "obligatoire_seulement" ? "default" : "outline"}
            onClick={() =>
              basculer({
                mode: prefs?.mode === "obligatoire_seulement" ? "tout" : "obligatoire_seulement",
              })
            }
          >
            {prefs?.mode === "obligatoire_seulement" ? "Obligations seules" : "Tout suivre"}
          </Button>
          <Button
            size="sm"
            variant={prefs?.active ? "outline" : "default"}
            onClick={() => basculer({ active: !prefs?.active })}
          >
            {prefs?.active ? "Suspendre la veille" : "Réactiver la veille"}
          </Button>
        </div>
        {nonLues > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await marquerToutVeilleLu(nouveautes.map((n) => n.id));
              window.dispatchEvent(new CustomEvent(EVT_VEILLE_LUE));
              charger();
            }}
          >
            <Check /> Tout marquer comme lu ({nonLues})
          </Button>
        )}
      </div>

      {/* Un profil sans champ discriminant reçoit les mêmes obligations universelles que tout le
          monde : la veille paraît alors identique d'un compte à l'autre, et on ne comprend pas
          pourquoi. Le dire est plus honnête que de laisser croire à un écran figé. */}
      {profilIncomplet && (
        <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Veille non personnalisée.</span> Sans
            régime ni catégorie fiscale connus, vous ne recevez que les obligations qui
            s&apos;imposent à tous.
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/onboarding/verification">Compléter mon profil</Link>
          </Button>
        </div>
      )}

      {nouveautes.length === 0 ? (
        <div className="space-y-4 rounded-2xl border border-dashed border-border p-8 text-center">
          {/* Deux causes opposées derrière un même écran vide. Les confondre rendait la veille
              impossible à diagnostiquer : « rien ne me concerne » et « rien n'a été collecté »
              appellent des gestes différents. */}
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            {catalogueVide
              ? "Le catalogue de veille est vide : aucune collecte n'a encore abouti sur les sources officielles."
              : "Aucune nouveauté réglementaire pour votre situation pour l'instant — vous ne verrez ici que ce qui change réellement quelque chose pour vous."}
          </p>
          {catalogueVide && (
            <Button size="sm" variant="outline" onClick={collecter} disabled={collecteEnCours}>
              {collecteEnCours ? (
                <>
                  <Loader2 className="animate-spin" /> Collecte en cours…
                </>
              ) : (
                <>
                  <RefreshCw /> Lancer une collecte
                </>
              )}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {nouveautes.map((n) => (
            <VeilleCard key={n.id} n={n} age={ageDe(n, nouveauxIds)} />
          ))}
        </div>
      )}

      {catalogue?.derniere_collecte && (
        <p className="rule-label-lg pt-1 text-center text-label-ink">
          Dernière collecte&nbsp;:{" "}
          {new Date(catalogue.derniere_collecte).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Ouvre le Centre d'Actions dans un panneau latéral.
 *
 * Le panneau s'appuie sur le Sheet shadcn (Radix Dialog), qui porte son contenu dans <body> :
 * c'est ce qui l'empêche d'être rogné par le `backdrop-blur` de la barre de navigation — un
 * filtre CSS crée un « containing block » pour les descendants en `position: fixed`, et sans
 * cette mise en portail le panneau restait contraint à la hauteur du <nav>.
 */
/**
 * Bouton d'ouverture du Centre d'Actions.
 *
 * Deux entrées, parce que ce sont deux urgences différentes : le CALENDRIER donne l'agenda
 * qu'on consulte quand on le décide, la CLOCHE signale ce qui vient de tomber et qu'on n'a pas
 * demandé. Mélanger les deux sur une seule icône revenait à noyer l'alerte dans la routine.
 */
export function CentreActionsButton({
  variante = "agenda",
}: {
  variante?: "agenda" | "veille";
}) {
  const estCloche = variante === "veille";
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState<Vue>(variante);
  const [nonLues, setNonLues] = useState(0);
  const plan = usePlan();

  // Point de comparaison du toast. Dans un `ref`, pas dans une variable de l'effet : l'effet se
  // rejoue à chaque ouverture ou fermeture du panneau, ce qui remettait le repère à `null` et
  // empêchait à tout jamais la détection d'une arrivée. `null` = première lecture, on affiche le
  // compteur sans rien annoncer — sinon chaque connexion sonnerait pour du déjà-connu.
  const precedent = useRef<number | null>(null);

  // Compteur de nouveautés non lues : sans lui, une veille qui trouve quelque chose reste
  // invisible tant que personne n'ouvre le panneau — donc invisible pour de bon.
  // La lecture est sans coût côté serveur (rien qu'une requête Mongo, aucun appel LLM).
  useEffect(() => {
    if (plan !== "premium" || !estCloche) return;
    let annule = false;

    const rafraichir = () =>
      fetchNotificationsVeille(true)
        .then((r) => {
          if (annule) return;
          if (precedent.current !== null && r.non_lues > precedent.current) {
            const arrivees = r.non_lues - precedent.current;
            toast.info(
              arrivees > 1
                ? `${arrivees} nouveautés réglementaires vous concernent`
                : "Une nouveauté réglementaire vous concerne",
              { description: "Ouvrez la veille pour la consulter." },
            );
          }
          precedent.current = r.non_lues;
          setNonLues(r.non_lues);
        })
        .catch(() => {});

    const remiseAZero = () => {
      precedent.current = 0;
      setNonLues(0);
    };
    window.addEventListener(EVT_VEILLE_LUE, remiseAZero);
    rafraichir();
    // Le cycle de veille tourne côté serveur : on resynchronise périodiquement plutôt que
    // d'attendre un rechargement de page.
    const timer = setInterval(rafraichir, 5 * 60 * 1000);
    return () => {
      annule = true;
      clearInterval(timer);
      window.removeEventListener(EVT_VEILLE_LUE, remiseAZero);
    };
  }, [plan, ouvert, estCloche]);

  return (
    <Sheet
      open={ouvert}
      onOpenChange={(next) => {
        setOuvert(next);
        if (next) setVue(variante);
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          title={
            estCloche
              ? nonLues > 0
                ? `${nonLues} nouveauté${nonLues > 1 ? "s" : ""} réglementaire${nonLues > 1 ? "s" : ""}`
                : "Veille réglementaire"
              : "Agenda fiscal"
          }
          aria-label={
            estCloche
              ? nonLues > 0
                ? `Ouvrir la veille réglementaire, ${nonLues} nouveauté${nonLues > 1 ? "s" : ""} non lue${nonLues > 1 ? "s" : ""}`
                : "Ouvrir la veille réglementaire"
              : "Ouvrir l'agenda fiscal"
          }
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-full border transition-all duration-200 active:scale-95",
            nonLues > 0
              ? "border-accent/50 bg-accent/10 text-accent-ink hover:border-accent"
              : "border-border text-muted-foreground hover:border-ink hover:text-foreground",
          )}
        >
          {estCloche ? (
            <Bell className={cn("size-3.5", nonLues > 0 && "animate-cloche")} />
          ) : (
            <CalendarDays className="size-3.5" />
          )}
          {estCloche && nonLues > 0 && (
            <>
              {/* Compteur en rouge : c'est la convention universelle du « non lu ». Le safran
                  reste la couleur de l'action volontaire (passer Premium, déclarer) ; le rouge
                  dit « ceci vous attend », ce qui n'est pas la même chose. */}
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-4 animate-ping rounded-full bg-destructive/40"
              />
              <span
                aria-hidden
                className="num absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-xs font-semibold text-destructive-foreground ring-2 ring-background"
              >
                {nonLues > 9 ? "9+" : nonLues}
              </span>
            </>
          )}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetDescription className="rule-label-lg text-accent-ink">
            Échéances &amp; veille
          </SheetDescription>
          <SheetTitle className="font-display text-lg font-medium">Centre d&apos;Actions</SheetTitle>
        </SheetHeader>

        <div className="chat-scroll flex-1 space-y-5 overflow-y-auto p-6">
          {plan === "free" ? (
            <div className="space-y-4 rounded-2xl border border-accent/35 bg-accent/8 p-8 text-center">
              <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                L&apos;agenda fiscal et la veille personnalisée font partie des fonctionnalités
                Premium.
              </p>
              <Button asChild variant="accent">
                <Link to="/premium">
                  <Sparkles /> Découvrir Premium
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {vue !== "historique" && (
                <div className="flex gap-2">
                  {(
                    [
                      { value: "agenda" as const, label: "Agenda fiscal" },
                      { value: "veille" as const, label: "Veille réglementaire" },
                    ]
                  ).map((onglet) => (
                    <button
                      key={onglet.value}
                      type="button"
                      onClick={() => setVue(onglet.value)}
                      aria-pressed={vue === onglet.value}
                      className={cn(
                        "flex-1 rounded-xl px-4 py-2 text-[0.9375rem] font-medium transition-all duration-200",
                        vue === onglet.value
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card text-muted-foreground hover:border-ink hover:text-foreground",
                      )}
                    >
                      {onglet.label}
                    </button>
                  ))}
                </div>
              )}
              {vue === "agenda" && <VueAgenda onOuvrirHistorique={() => setVue("historique")} />}
              {vue === "veille" && <VueVeille />}
              {vue === "historique" && <VueHistorique onRetour={() => setVue("agenda")} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
