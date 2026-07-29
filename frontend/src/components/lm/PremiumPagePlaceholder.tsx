import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { PremiumLock } from "@/components/lm/PremiumLock";

type Kind = "dashboard" | "referral" | "capture" | "simulateur" | "historique" | "parametres";

const COPY: Record<
  Kind,
  {
    eyebrow: string;
    title: React.ReactNode;
    description: string;
    lockTitle: string;
    pitch: string;
    bullets: { icon: string; label: string; hint: string }[];
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
      { icon: "🧾", label: "Reçu fiscal", hint: "Perforations, provisions, statut TVA en temps réel." },
      { icon: "📊", label: "Pipeline", hint: "Vérification, qualification, conformité, rapport." },
      { icon: "🎯", label: "Actions", hint: "Ce qu'il faut faire, dans l'ordre, sans jargon." },
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
      { icon: "🗺️", label: "Géolocalisé", hint: "Cabinets proches, spécialisés dans votre profil." },
      { icon: "✉️", label: "Emails prêts", hint: "Rédigés à votre voix, prêts à envoyer." },
      { icon: "🤝", label: "Suivi", hint: "Historique et relances gérés automatiquement." },
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
      { icon: "📸", label: "OCR intelligent", hint: "Factures, tickets, relevés bancaires en un glisser." },
      { icon: "🏷️", label: "Classification", hint: "Nature comptable et déductibilité auto-détectées." },
      { icon: "💾", label: "Archivage légal", hint: "Conservation 10 ans, exportable au format FEC." },
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
      { icon: "💬", label: "Langage naturel", hint: "«Un client US me paie 8000$ en 3 mois» — c'est tout." },
      { icon: "📐", label: "Calcul détaillé", hint: "Chaque ligne fiscale, sourcée sur le CGI." },
      { icon: "⚖️", label: "Comparaison", hint: "Deux scénarios côte à côte, verdict fiscal net." },
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
      { icon: "🔎", label: "Recherche", hint: "Par client, montant, statut TVA, période." },
      { icon: "📤", label: "Export FEC", hint: "Format DGFiP prêt pour votre expert-comptable." },
      { icon: "🧮", label: "Analytics", hint: "CA glissant, ratios, alertes de plafond." },
    ],
    preview: <MockTable />,
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
      { icon: "👤", label: "Multi-activités", hint: "BIC, BNC, mixte — gestion séparée." },
      { icon: "🔗", label: "Connexions", hint: "Banques, INPI, DGFiP — synchronisées." },
      { icon: "🛡️", label: "Sécurité", hint: "2FA, sessions, exports chiffrés." },
    ],
    preview: <MockList rows={["Identité fiscale", "Régime & plafonds", "Connexions bancaires", "Accès expert-comptable"]} />,
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

/* ------------------------- Mock previews (blurred) ------------------------ */

function MockDashboard() {
  return (
    <div className="grid lg:grid-cols-12 gap-8">
      <div className="lg:col-span-7 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-border rounded-2xl p-6 h-28" />
          ))}
        </div>
        <div className="bg-white border border-border rounded-2xl p-8 h-40" />
        <div className="bg-white border border-border rounded-2xl h-48" />
      </div>
      <div className="lg:col-span-5">
        <div className="bg-white border border-border rounded-2xl h-[420px] perforated-top perforated-bottom" />
      </div>
    </div>
  );
}
function MockList({ rows }: { rows: string[] }) {
  return (
    <div className="bg-white border border-border rounded-2xl divide-y divide-border">
      {rows.map((r) => (
        <div key={r} className="p-5 flex items-center justify-between">
          <span className="text-sm">{r}</span>
          <span className="font-mono text-xs text-ink/40">→</span>
        </div>
      ))}
    </div>
  );
}
function MockGrid() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[4/3] bg-white border border-border rounded-2xl" />
      ))}
    </div>
  );
}
function MockCalc() {
  return (
    <div className="bg-white border border-border rounded-2xl p-8 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-6 dotted-divider" />
      ))}
    </div>
  );
}
function MockTable() {
  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 border-b border-border last:border-0" />
      ))}
    </div>
  );
}
