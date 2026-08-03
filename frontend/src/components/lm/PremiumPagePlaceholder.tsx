import {
  ArrowLeftRight,
  ArrowRight,
  Archive,
  Eye,
  FileText,
  BarChart3,
  Calculator,
  Camera,
  Handshake,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  ReceiptText,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Tags,
  Target,
  TrendingUp,
  Upload,
  UserCog,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/api";
import { RoadmapView } from "@/components/lm/RoadmapView";
import {
  DEMO_ANALYSE_JURIDIQUE,
  DEMO_HISTORIQUE,
  DEMO_INVOICE,
  DEMO_PROFIL,
  DEMO_ROADMAP,
  DEMO_SCENARIOS,
  DEMO_TRANSFER,
} from "@/lib/demo";
import { cn } from "@/lib/utils";
import { PremiumLock, type PremiumBullet } from "@/components/lm/PremiumLock";

/** Écrans disposant d'un aperçu de démonstration derrière le paywall. */
export type PremiumKind =
  | "dashboard"
  | "referral"
  | "capture"
  | "simulateur"
  | "historique"
  | "parametres"
  | "activite";

type Kind = PremiumKind;

const COPY: Record<
  Kind,
  {
    eyebrow: string;
    title: React.ReactNode;
    description: string;
    lockTitle: string;
    pitch: string;
    bullets: PremiumBullet[];
    preview: React.ReactNode;
  }
> = {
  dashboard: {
    eyebrow: "Ma situation",
    title: (
      <>
        Votre situation, <span className="italic font-normal">à jour.</span>
      </>
    ),
    description: "Reçu fiscal, provisions, pipeline — tout votre cabinet dans une page.",
    lockTitle: "Ma situation fiscale",
    pitch:
      "Un reçu fiscal signature, vos provisions calculées au trimestre, un pipeline vivant de votre conformité. Le pilotage complet, sans tableur.",
    bullets: [
      { icon: ReceiptText, label: "Reçu fiscal", hint: "Perforations, provisions, statut TVA en temps réel." },
      { icon: BarChart3, label: "Pipeline", hint: "Vérification, qualification, conformité, rapport." },
      { icon: Target, label: "Actions", hint: "Ce qu'il faut faire, dans l'ordre, sans jargon." },
    ],
    preview: <MockDashboard />,
  },
  referral: {
    eyebrow: "Expert-comptable",
    title: (
      <>
        Le bon expert, <span className="italic font-normal">déjà contacté.</span>
      </>
    ),
    description: "On trouve le cabinet, on rédige l'email, vous validez.",
    lockTitle: "Mise en relation expert-comptable",
    pitch:
      "Recherche géolocalisée, scoring de compatibilité, emails d'introduction personnalisés générés pour vous. Zéro cold-email à écrire.",
    bullets: [
      { icon: MapPin, label: "Géolocalisé", hint: "Cabinets proches, spécialisés dans votre profil." },
      { icon: Mail, label: "Emails prêts", hint: "Rédigés à votre voix, prêts à envoyer." },
      { icon: Handshake, label: "Suivi", hint: "Historique et relances gérés automatiquement." },
    ],
    preview: <MockList rows={["Cabinet Aurore — Paris 11e", "Fiducie Nord — Lille", "Cabinet Riviera — Nice"]} />,
  },
  capture: {
    eyebrow: "Justificatifs",
    title: (
      <>
        Vos factures, <span className="italic font-normal">qualifiées seules.</span>
      </>
    ),
    description: "Déposez. LedgerMind lit, extrait, classe, provisionne.",
    lockTitle: "Justificatifs et OCR",
    pitch:
      "OCR bancaire, extraction TVA, classification par nature comptable, contrôle de déductibilité — chaque document devient un reçu fiscal.",
    bullets: [
      { icon: Camera, label: "OCR intelligent", hint: "Factures, tickets, relevés bancaires en un glisser." },
      { icon: Tags, label: "Classification", hint: "Nature comptable et déductibilité auto-détectées." },
      { icon: Archive, label: "Archivage légal", hint: "Conservation 10 ans, exportable au format FEC." },
    ],
    preview: <MockGrid />,
  },
  simulateur: {
    eyebrow: "Scénarios",
    title: (
      <>
        Et si je signais <span className="italic font-normal">ce contrat ?</span>
      </>
    ),
    description: "Décrivez la situation, on montre l'impact fiscal ligne par ligne.",
    lockTitle: "Scénarios fiscaux",
    pitch:
      "Décrivez un contrat en français simple. LedgerMind calcule TVA, retenue à la source, cotisations, net à provisionner. Décidez en 30 secondes.",
    bullets: [
      { icon: MessageSquare, label: "Langage naturel", hint: "«Un client US me paie 8000$ en 3 mois» — c'est tout." },
      { icon: Ruler, label: "Calcul détaillé", hint: "Chaque ligne fiscale, sourcée sur le CGI." },
      { icon: Scale, label: "Comparaison", hint: "Deux scénarios côte à côte, verdict fiscal net." },
    ],
    preview: <MockCalc />,
  },
  historique: {
    eyebrow: "Transactions",
    title: (
      <>
        Toutes vos opérations, <span className="italic font-normal">indexées.</span>
      </>
    ),
    description: "Reçus fiscaux, filtres, exports comptables.",
    lockTitle: "Transactions et historique",
    pitch:
      "Chaque transaction devient un reçu fiscal cherchable. Filtres par régime, client, période. Export FEC en un clic pour votre expert-comptable.",
    bullets: [
      { icon: Search, label: "Recherche", hint: "Par client, montant, statut TVA, période." },
      { icon: Upload, label: "Export FEC", hint: "Format DGFiP prêt pour votre expert-comptable." },
      { icon: Calculator, label: "Analytics", hint: "CA glissant, ratios, alertes de plafond." },
    ],
    preview: <MockTable />,
  },
  activite: {
    eyebrow: "Facturation",
    title: (
      <>
        De la facture <span className="italic font-normal">à la déclaration.</span>
      </>
    ),
    description: "Facturez, consolidez, préparez votre déclaration, faites-la valider.",
    lockTitle: "Facturation et déclaration",
    pitch:
      "Émettez vos factures avec les mentions légales sourcées, obtenez un rapport de période avec vos chiffres clés, préparez votre déclaration ligne par ligne, puis faites-la vérifier par un expert-comptable proche.",
    bullets: [
      { icon: ReceiptText, label: "Facture", hint: "Mentions légales vérifiées à la source, numérotation continue." },
      { icon: TrendingUp, label: "Rapport & déclaration", hint: "Chiffres déterministes, provenance de chaque montant." },
      { icon: Handshake, label: "Expert-comptable", hint: "Recherche neutre, annuaire officiel de l'Ordre." },
    ],
    preview: <MockList rows={["1. Facture", "2. Rapport de période", "3. Déclaration préparée", "4. Expert-comptable"]} />,
  },
  parametres: {
    eyebrow: "Mon compte",
    title: (
      <>
        Votre profil, <span className="italic font-normal">votre régime.</span>
      </>
    ),
    description: "Identité fiscale, préférences, accès, exports.",
    lockTitle: "Mon compte",
    pitch:
      "Gestion multi-activités, préférences de calcul, accès expert-comptable, connexions bancaires — tout votre paramétrage fin.",
    bullets: [
      { icon: UserCog, label: "Multi-activités", hint: "BIC, BNC, mixte — gestion séparée." },
      { icon: Link2, label: "Connexions", hint: "Banques, INPI, DGFiP — synchronisées." },
      { icon: ShieldCheck, label: "Sécurité", hint: "2FA, sessions, exports chiffrés." },
    ],
    preview: <MockProfil />,
  },
};

export function PremiumPagePlaceholder({ kind }: { kind: Kind }) {
  const c = COPY[kind];
  return (
    <AppShell>
      <PageHeader eyebrow={c.eyebrow} title={c.title} description={c.description} />
      <PremiumLock
        eyebrow={c.eyebrow}
        title={c.lockTitle}
        pitch={c.pitch}
        bullets={c.bullets}
        preview={c.preview}
      >
        {null}
      </PremiumLock>
    </AppShell>
  );
}

/* --------------------------- Aperçus de démonstration -------------------------- */
/* Contenu réel (jeu de démonstration, voir lib/demo.ts) plutôt que des blocs gris : au palier
   gratuit, l'utilisateur doit pouvoir juger ce qu'il débloquerait, pas le deviner. */

function euros(n: number): string {
  return `${formatMoney(n)} €`;
}

function CarteDemo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-soft", className)}>
      {children}
    </div>
  );
}

/**
 * Hero du diagnostic : le bandeau tel qu'il apparaît une fois le parcours fait, avec son
 * étiquette de démonstration posée dessus — elle ne peut pas être manquée à cet endroit.
 */
function HeroDiagnostic() {
  const b = DEMO_ROADMAP.bandeau ?? {};
  return (
    <div className="surface-ink relative overflow-hidden rounded-3xl p-8 md:p-10">
      <div aria-hidden className="surface-grain absolute inset-0 opacity-50" />
      <div
        aria-hidden
        className="absolute -right-20 -top-20 size-56 rounded-full bg-accent/20 blur-3xl"
      />
      <div className="relative">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <p className="rule-label text-accent">{b.type}</p>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-foreground/25 px-3 py-1 font-mono text-[0.55rem] font-medium uppercase tracking-[0.16em] text-ink-foreground/70">
            <Eye className="size-3" /> Exemple de démonstration
          </span>
        </div>
        <h2 className="text-balance text-3xl leading-tight text-ink-foreground md:text-4xl">
          {b.titre}
        </h2>
        <p className="mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-ink-foreground/70">
          {b.texte}
        </p>
      </div>
    </div>
  );
}

/**
 * Les quatre constats du diagnostic.
 *
 * Deux colonnes, pas quatre : dans la colonne centrale d'un paywall, quatre cartes laissent
 * moins de 200px chacune et des libellés comme « Activité durable (récurrence > 6 mois) »
 * s'y cassent sur quatre lignes. Deux colonnes tiennent la phrase sur une ou deux lignes.
 */
function CartesStatut() {
  const cartes = [
    { label: "Régime recommandé", valeur: DEMO_ROADMAP.regime_recommande },
    { label: "Catégorie", valeur: "BNC — prestations de services" },
    { label: "Durabilité", valeur: "Activité durable (récurrence > 6 mois)" },
    { label: "Parcours", valeur: "Création d'entreprise individuelle" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cartes.map((c) => (
        <CarteDemo key={c.label}>
          <p className="rule-label mb-3 text-muted-foreground">{c.label}</p>
          <p className="font-display text-lg leading-snug text-balance">{c.valeur}</p>
        </CarteDemo>
      ))}
    </div>
  );
}

/** Le raisonnement derrière le régime retenu, poste par poste. */
function AnalyseJuridique() {
  const a = DEMO_ANALYSE_JURIDIQUE;
  const lignes: [string, ReactNode][] = [
    ["Seuil de CA applicable", <span className="num">{a.seuil_ca_applicable}</span>],
    ["Ratio utilisé", <span className="num">{a.ratio_utilise}</span>],
    ["Durée d'activité", <span className="num">{a.duree_activite}</span>],
    [
      "Motifs",
      <span className="flex flex-col items-end gap-0.5">
        {a.motifs.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </span>,
    ],
  ];
  return (
    <CarteDemo className="p-0">
      <div className="flex items-center gap-3 p-5">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/8 text-primary">
          <Scale className="size-4" />
        </span>
        <h3 className="text-lg">Analyse juridique</h3>
      </div>
      <dl className="divide-y divide-border border-t border-border">
        {lignes.map(([label, valeur]) => (
          <div key={label} className="flex items-start justify-between gap-6 px-5 py-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{valeur}</dd>
          </div>
        ))}
      </dl>
    </CarteDemo>
  );
}

/** Le tableau de bord tel qu'il sera : diagnostic, constats, raisonnement, feuille de route. */
function MockDashboard() {
  return (
    <div className="space-y-6">
      <HeroDiagnostic />
      <CartesStatut />
      <AnalyseJuridique />
      <div>
        <p className="rule-label mb-4 text-accent-ink">Votre feuille de route</p>
        <RoadmapView roadmap={DEMO_ROADMAP} />
      </div>
    </div>
  );
}

function MockList({ rows }: { rows: string[] }) {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card">
      {rows.map((r) => (
        <div key={r} className="flex items-center justify-between p-4">
          <span className="text-sm">{r}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" />
        </div>
      ))}
    </div>
  );
}

/** Capture : la facture lue ligne à ligne, et le virement qui la règle. */
function MockGrid() {
  const f = DEMO_INVOICE;
  const v = DEMO_TRANSFER;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CarteDemo className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="success">
            <FileText /> Facture
          </Badge>
          <span className="num text-xs text-muted-foreground">{f.invoice_number}</span>
        </div>
        <div>
          <p className="font-medium">{f.issuer_name}</p>
          <p className="text-xs text-muted-foreground">
            {f.client_name} · émise le {f.issue_date}
          </p>
        </div>
        <div className="space-y-1.5">
          {f.line_items.map((li) => (
            <div
              key={li.description}
              className="flex justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs"
            >
              <span className="truncate text-muted-foreground">
                {li.description} × {li.quantity}
              </span>
              <span className="num shrink-0">{euros(li.total)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Total TTC</span>
          <span className="num font-medium">{euros(f.total_ttc)}</span>
        </div>
        <Badge variant="warning">Échéance dans {f.payment_days_until} jours</Badge>
        {f.incoherences.map((inc) => (
          <p
            key={inc}
            className="rounded-lg border border-warning/40 bg-warning/12 px-3 py-2 text-xs text-warning-ink"
          >
            {inc}
          </p>
        ))}
      </CarteDemo>

      <CarteDemo className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="info">
            <ArrowLeftRight /> Virement
          </Badge>
          <span className="num text-xs text-muted-foreground">{v.transfer_reference}</span>
        </div>
        <div>
          <p className="font-medium">{v.sender_name}</p>
          <p className="text-xs text-muted-foreground">
            {v.direction} · exécuté le {v.execution_date}
          </p>
        </div>
        {[
          ["Montant", euros(v.amount)],
          ["Banque", v.bank_name],
          ["Type", v.transfer_type],
        ].map(([label, valeur]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="num font-medium">{valeur}</span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{v.motif}</p>
      </CarteDemo>
    </div>
  );
}

/** Simulateur : les scénarios projetés du diagnostic. */
function MockCalc() {
  return (
    <div className="space-y-3">
      {DEMO_SCENARIOS.map((sc) => (
        <CarteDemo key={sc.titre} className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{sc.titre}</p>
            <p className="text-sm text-muted-foreground">{sc.impact}</p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {sc.action}
          </Badge>
        </CarteDemo>
      ))}
      <CarteDemo className="space-y-2">
        <p className="rule-label text-muted-foreground">Analyse juridique</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Seuil applicable <span className="num text-foreground">{DEMO_ANALYSE_JURIDIQUE.seuil_ca_applicable}</span>
          </span>
          <span className="text-muted-foreground">
            Ratio utilisé <span className="num text-foreground">{DEMO_ANALYSE_JURIDIQUE.ratio_utilise}</span>
          </span>
          <span className="text-muted-foreground">
            Durée <span className="num text-foreground">{DEMO_ANALYSE_JURIDIQUE.duree_activite}</span>
          </span>
        </div>
        {DEMO_ANALYSE_JURIDIQUE.motifs.map((m) => (
          <p key={m} className="text-sm text-muted-foreground">
            · {m}
          </p>
        ))}
      </CarteDemo>
    </div>
  );
}

/** Profil : l'identité fiscale telle qu'elle sera renseignée, section par section. */
function MockProfil() {
  return (
    <div className="space-y-4">
      {DEMO_PROFIL.map((bloc) => (
        <CarteDemo key={bloc.section} className="p-0">
          <p className="rule-label border-b border-border p-5 text-accent-ink">{bloc.section}</p>
          <dl className="divide-y divide-border">
            {bloc.champs.map((c) => (
              <div key={c.label} className="flex items-start justify-between gap-6 px-5 py-3 text-sm">
                <dt className="text-muted-foreground">{c.label}</dt>
                <dd className={cn("text-right font-medium", c.mono && "num")}>{c.valeur}</dd>
              </div>
            ))}
          </dl>
        </CarteDemo>
      ))}
    </div>
  );
}

/** Historique : de vraies écritures, avec leur statut de qualification. */
function MockTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th className="rule-label px-4 py-3 text-left text-muted-foreground">Référence</th>
              <th className="rule-label px-4 py-3 text-left text-muted-foreground">Client</th>
              <th className="rule-label px-4 py-3 text-right text-muted-foreground">Net</th>
              <th className="rule-label px-4 py-3 text-right text-muted-foreground">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {DEMO_HISTORIQUE.map((row) => (
              <tr key={row.reference}>
                <td className="num px-4 py-3 text-xs text-muted-foreground">{row.reference}</td>
                <td className="px-4 py-3 font-medium">{row.client}</td>
                <td className="num px-4 py-3 text-right">{euros(row.net)}</td>
                <td className="px-4 py-3 text-right">
                  <Badge variant={row.statut === "Qualifié" ? "success" : "warning"}>
                    {row.statut}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
