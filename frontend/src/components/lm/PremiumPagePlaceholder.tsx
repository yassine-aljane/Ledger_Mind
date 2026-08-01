import {
  Archive,
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
import { PremiumLock, type PremiumBullet } from "@/components/lm/PremiumLock";
import { usePlan } from "@/lib/plan";

type Kind = "dashboard" | "referral" | "capture" | "simulateur" | "historique" | "parametres" | "activite";

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
    eyebrow: "Dashboard",
    title: (
      <>
        Votre situation, <span className="italic font-normal">à jour.</span>
      </>
    ),
    description: "Reçu fiscal, provisions, pipeline — tout votre cabinet dans une page.",
    lockTitle: "Votre tableau de bord fiscal",
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
    eyebrow: "Expert-Comptable",
    title: (
      <>
        Le bon expert, <span className="italic font-normal">déjà contacté.</span>
      </>
    ),
    description: "On trouve le cabinet, on rédige l'email, vous validez.",
    lockTitle: "Mise en relation experts-comptables",
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
    eyebrow: "Documents",
    title: (
      <>
        Vos factures, <span className="italic font-normal">qualifiées seules.</span>
      </>
    ),
    description: "Déposez. LedgerMind lit, extrait, classe, provisionne.",
    lockTitle: "Capture & OCR de justificatifs",
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
    eyebrow: "Simulateur",
    title: (
      <>
        Et si je signais <span className="italic font-normal">ce contrat ?</span>
      </>
    ),
    description: "Décrivez la situation, on montre l'impact fiscal ligne par ligne.",
    lockTitle: "Simulateur en langage naturel",
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
    eyebrow: "Historique",
    title: (
      <>
        Toutes vos opérations, <span className="italic font-normal">indexées.</span>
      </>
    ),
    description: "Reçus fiscaux, filtres, exports comptables.",
    lockTitle: "Historique fiscal complet",
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
    eyebrow: "Activité",
    title: (
      <>
        De la facture <span className="italic font-normal">à la déclaration.</span>
      </>
    ),
    description: "Facturez, consolidez, préparez votre déclaration, faites-la valider.",
    lockTitle: "Parcours activité complet",
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
    eyebrow: "Paramètres",
    title: (
      <>
        Votre profil, <span className="italic font-normal">votre régime.</span>
      </>
    ),
    description: "Identité fiscale, préférences, accès, exports.",
    lockTitle: "Profil fiscal avancé",
    pitch:
      "Gestion multi-activités, préférences de calcul, accès expert-comptable, connexions bancaires — tout votre paramétrage fin.",
    bullets: [
      { icon: UserCog, label: "Multi-activités", hint: "BIC, BNC, mixte — gestion séparée." },
      { icon: Link2, label: "Connexions", hint: "Banques, INPI, DGFiP — synchronisées." },
      { icon: ShieldCheck, label: "Sécurité", hint: "2FA, sessions, exports chiffrés." },
    ],
    preview: <MockList rows={["Identité fiscale", "Régime & plafonds", "Connexions bancaires", "Accès expert-comptable"]} />,
  },
};

/**
 * Barrière Premium d'un écran entier.
 *
 * Le contrôle vit ICI, autour de la page, et non en tête de la page elle-même : sortir en
 * `return` avant les hooks de l'écran les rendrait conditionnels (ordre des hooks différent d'un
 * rendu à l'autre — bug React, signalé par `react-hooks/rules-of-hooks`). Avec cette barrière,
 * la page n'est tout simplement pas montée quand elle est verrouillée : ni hooks, ni requêtes,
 * ni redirection d'authentification déclenchés pour rien.
 */
export function PremiumGate({ kind, children }: { kind: Kind; children: ReactNode }) {
  const plan = usePlan();
  if (plan === "free") return <PremiumPagePlaceholder kind={kind} />;
  return <>{children}</>;
}

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

/* ------------------------- Mock previews (blurred) ------------------------ */

function MockDashboard() {
  return (
    <div className="grid lg:grid-cols-12 gap-8">
      <div className="lg:col-span-7 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-6 h-28" />
          ))}
        </div>
        <div className="bg-card border border-border rounded-2xl p-8 h-40" />
        <div className="bg-card border border-border rounded-2xl h-48" />
      </div>
      <div className="lg:col-span-5">
        <div className="bg-card border border-border rounded-2xl h-[420px] perforated-top perforated-bottom" />
      </div>
    </div>
  );
}
function MockList({ rows }: { rows: string[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl divide-y divide-border">
      {rows.map((r) => (
        <div key={r} className="p-5 flex items-center justify-between">
          <span className="text-sm">{r}</span>
          <span className="num text-xs text-muted-foreground">→</span>
        </div>
      ))}
    </div>
  );
}
function MockGrid() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-4/3 rounded-2xl border border-border bg-card" />
      ))}
    </div>
  );
}
function MockCalc() {
  return (
    <div className="bg-card border border-border rounded-2xl p-8 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-6 dotted-divider" />
      ))}
    </div>
  );
}
function MockTable() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 border-b border-border last:border-0" />
      ))}
    </div>
  );
}
