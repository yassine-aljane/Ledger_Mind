import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Clock,
  Database,
  FileText,
  Globe2,
  Lock,
  Mail,
  ScrollText,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { MarketingLayout } from "@/components/lm/Marketing";

/**
 * Politique de confidentialité (RGPD, art. 13).
 *
 * Contrairement à la politique cookies — qui ne concerne que l'appareil du visiteur — cette page
 * couvre le traitement des données côté serveur : c'est le document réellement OBLIGATOIRE, et
 * celui qu'attend un utilisateur qui confie un KBIS, des factures et des relevés.
 *
 * Chaque durée et chaque destinataire ci-dessous correspond au comportement réel du backend :
 *   • purge des conversations et profils anonymes  → `app/core/conversation_store.py` (_TTL_DAYS)
 *   • durée du jeton de connexion                  → `app/config.py` (auth_token_days)
 *   • répartition Gemini / Mistral                 → `app/llm/__init__.py`
 *   • OCR local (SIRET, avis de situation)         → `app/services/ocr_siret.py` (RapidOCR)
 *   • OCR et extraction des justificatifs          → `app/agents/capture/app/config.py` (Mistral)
 *   • originaux des pièces                         → GridFS, `app/agents/capture/app/db.py`
 *   • services publics interrogés                  → INSEE/INPI/RNE, adresse, Nominatim, Overpass
 * Annoncer une durée que le code n'applique pas serait une déclaration inexacte : toute évolution
 * de ces fichiers doit être répercutée ici.
 *
 * AVANT MISE EN LIGNE — à compléter par l'équipe (voir `docs/RGPD-ET-SECURITE.md` § 8) :
 * l'identité du responsable de traitement, l'hébergeur et sa région, et la vérification effective
 * des garanties de transfert hors UE mentionnées en section 5.
 */

const MAJ = "10 août 2026";

/** À remplacer par l'adresse de contact réelle avant mise en ligne. */
const CONTACT = "privacy@ledgermind.fr";

type Categorie = { titre: string; donnees: string; origine: string };

const CATEGORIES: Categorie[] = [
  {
    titre: "Compte",
    donnees: "Nom, adresse email, mot de passe (jamais stocké en clair), date de création.",
    origine: "Vous, à l'inscription",
  },
  {
    titre: "Situation fiscale",
    donnees:
      "Type d'activité, chiffre d'affaires estimé, situation d'immatriculation, régime, réponses au diagnostic, feuille de route et échéancier qui en découlent.",
    origine: "Vous, pendant la mise en route",
  },
  {
    titre: "Identifiants d'entreprise",
    donnees:
      "SIREN, SIRET, et les informations publiques renvoyées par les registres officiels (dénomination, activité, date d'immatriculation).",
    origine: "Vous, puis les registres publics",
  },
  {
    titre: "Justificatifs",
    donnees:
      "Factures, virements, contrats, cadeaux et dotations, extraits KBIS, avis de situation SIRENE : le fichier d'origine ainsi que les informations extraites (montants, dates, émetteur, devise).",
    origine: "Vous, par téléversement",
  },
  {
    titre: "Documents produits",
    donnees:
      "Factures que vous émettez, rapports fiscaux, déclarations pré-remplies, simulations enregistrées.",
    origine: "Générés à partir de vos données",
  },
  {
    titre: "Conversations",
    donnees:
      "Messages échangés avec l'assistant fiscal et avec l'agent de mise en route, et le fil auquel ils se rattachent.",
    origine: "Vous, en posant vos questions",
  },
  {
    titre: "Recherche d'expert-comptable",
    donnees:
      "Commune ou adresse saisie pour situer la recherche, et l'historique des recherches effectuées.",
    origine: "Vous, à la demande",
  },
  {
    titre: "Données techniques",
    donnees:
      "Adresse IP et journaux de connexion au service, nécessaires à son fonctionnement et à sa sécurité.",
    origine: "Automatique",
  },
];

type Destinataire = {
  nom: string;
  role: string;
  donnees: string;
  lieu: string;
  horsUe: boolean;
};

const DESTINATAIRES: Destinataire[] = [
  {
    nom: "MongoDB Atlas",
    role: "Hébergement de la base de données et des pièces d'origine",
    donnees: "L'ensemble des données de votre dossier",
    lieu: "Région d'hébergement précisée sur demande",
    horsUe: false,
  },
  {
    nom: "Mistral AI",
    role: "Assistant fiscal, agent de mise en route, lecture et classement des justificatifs",
    donnees: "Vos questions, et le contenu des documents que vous téléversez",
    lieu: "Union européenne (France)",
    horsUe: false,
  },
  {
    nom: "Google (Gemini)",
    role: "Compréhension de vos réponses au questionnaire, et levée d'ambiguïté sur les documents de registre",
    donnees:
      "Vos réponses au questionnaire de diagnostic, et le texte extrait d'un KBIS ou d'un avis RNE lorsque la lecture automatique est ambiguë",
    lieu: "Hors Union européenne",
    horsUe: true,
  },
  {
    nom: "Pinecone",
    role: "Index documentaire des pages de présentation du produit",
    donnees: "Aucune donnée personnelle — uniquement notre propre documentation",
    lieu: "Hors Union européenne (États-Unis)",
    horsUe: true,
  },
];

const SERVICES_PUBLICS: Array<[string, string]> = [
  [
    "Registres d'entreprises (INSEE, INPI, RNE)",
    "Le SIREN ou SIRET que vous saisissez, pour vérifier votre immatriculation.",
  ],
  [
    "Base Adresse Nationale, Nominatim et Overpass (OpenStreetMap)",
    "La commune ou l'adresse que vous indiquez, pour situer une recherche d'expert-comptable.",
  ],
  [
    "Annuaire des experts-comptables",
    "Le périmètre géographique de votre recherche, pour lister les cabinets.",
  ],
  [
    "Légifrance, BOFiP, URSSAF, impots.gouv.fr, BOSS",
    "Aucune donnée vous concernant : ces sources alimentent notre corpus fiscal, indépendamment de vous.",
  ],
];

type Duree = { quoi: string; combien: string; precision: string };

const DUREES: Duree[] = [
  {
    quoi: "Compte et dossier fiscal",
    combien: "Tant que le compte existe",
    precision:
      "Supprimés lorsque vous demandez la suppression de votre compte. Aucune purge automatique n'intervient tant qu'il est ouvert : vos données doivent rester disponibles d'un exercice à l'autre.",
  },
  {
    quoi: "Justificatifs et documents produits",
    combien: "Tant que le compte existe",
    precision:
      "Vous pouvez supprimer une pièce à tout moment depuis l'application : l'original et les informations extraites partent ensemble.",
  },
  {
    quoi: "Conversations sans compte",
    combien: "30 jours après le dernier message",
    precision:
      "Purge automatique. Le profil anonyme rattaché à la conversation est effacé au même moment.",
  },
  {
    quoi: "Jeton de connexion",
    combien: "14 jours",
    precision: "Passé ce délai, une nouvelle connexion est demandée.",
  },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="rule-label text-muted-foreground">
      <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
      {children}
    </p>
  );
}

function Section({
  icone: Icone,
  titre,
  children,
}: {
  icone: typeof Lock;
  titre: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-rise scroll-mt-24">
      <h2 className="flex items-center gap-2.5 text-2xl">
        <Icone className="size-4 shrink-0 text-safran" aria-hidden />
        {titre}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — LedgerMind" },
      {
        name: "description",
        content:
          "Quelles données LedgerMind traite, pourquoi, avec qui, combien de temps, et comment exercer vos droits.",
      },
      { property: "og:title", content: "Politique de confidentialité — LedgerMind" },
      {
        property: "og:description",
        content:
          "Vos justificatifs, votre dossier, vos conversations : ce qu'on en fait, et ce qu'on n'en fait pas.",
      },
    ],
  }),
  component: Confidentialite,
});

function Confidentialite() {
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-5 py-14 sm:py-20">
        <header className="animate-rise max-w-2xl">
          <SectionLabel>Confidentialité</SectionLabel>
          <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.05]">
            Politique de <span className="text-safran italic">confidentialité</span>
          </h1>
          <p className="mt-5 text-muted-foreground">
            Vous nous confiez des factures, un KBIS, parfois un contrat. Cette page dit exactement
            ce que ces documents deviennent : où ils sont stockés, qui les voit, combien de temps
            ils restent, et comment les faire disparaître.
          </p>
          <p className="num mt-4 text-xs text-muted-foreground">
            Dernière mise à jour : {MAJ} · Version 1.0
          </p>
        </header>

        <div className="animate-rise surface-ink mt-10 rounded-2xl p-6 text-ink-foreground sm:p-8">
          <p className="rule-label text-safran">L&apos;essentiel</p>
          <ul className="mt-4 space-y-2.5 leading-relaxed">
            <li>
              Vos documents servent à <span className="font-semibold">votre dossier</span>, à rien
              d&apos;autre : ni revente, ni publicité, ni entraînement de modèles.
            </li>
            <li>
              LedgerMind{" "}
              <span className="font-semibold">ne transmet rien à l&apos;administration</span> et ne
              se connecte à aucun compte bancaire.
            </li>
            <li>
              La lecture de vos justificatifs passe par un prestataire{" "}
              <span className="font-semibold">européen</span> ; un traitement limité reste hors UE,
              et il est détaillé en section 5.
            </li>
            <li>
              Vous pouvez demander la suppression de votre compte et de tout ce qu&apos;il contient.
            </li>
          </ul>
        </div>

        <div className="mt-14 space-y-14">
          {/* 1. Responsable */}
          <Section icone={UserCheck} titre="1. Qui est responsable de ces données ?">
            <p>
              LedgerMind détermine pourquoi et comment vos données sont traitées : c&apos;est donc
              le responsable de traitement au sens du RGPD. Pour toute question relative à cette
              politique ou pour exercer vos droits :{" "}
              <a
                href={`mailto:${CONTACT}`}
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                {CONTACT}
              </a>
              .
            </p>
            <p>
              Cette page ne traite que des données conservées sur nos serveurs. Ce que
              l&apos;application enregistre sur votre appareil relève de la{" "}
              <Link
                to="/cookies"
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                politique cookies
              </Link>
              , et vous pouvez le consulter en direct depuis l&apos;écran{" "}
              <Link
                to="/mes-donnees"
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                Mes données sur cet appareil
              </Link>
              .
            </p>
          </Section>

          {/* 2. Données */}
          <Section icone={Database} titre="2. Quelles données sont traitées">
            <p>
              Presque tout vient de vous : LedgerMind ne collecte rien à votre insu et n&apos;achète
              aucune donnée à des tiers.
            </p>
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <ul className="divide-y divide-border/60">
                {CATEGORIES.map((cat) => (
                  <li key={cat.titre} className="px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="font-medium text-foreground">{cat.titre}</h3>
                      <span className="rule-label shrink-0 text-muted-foreground">
                        {cat.origine}
                      </span>
                    </div>
                    <p className="mt-1.5">{cat.donnees}</p>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs">
              L&apos;Assistant fiscal reste utilisable sans compte : dans ce cas, seules la
              conversation et un identifiant aléatoire existent, sans lien avec votre identité.
            </p>
          </Section>

          {/* 3. Finalités */}
          <Section icone={ScrollText} titre="3. Pourquoi, et sur quel fondement">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="rule-label py-3 pr-5 text-muted-foreground">
                      Finalité
                    </th>
                    <th scope="col" className="rule-label py-3 pr-5 text-muted-foreground">
                      Base légale
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "Tenir votre dossier : diagnostic, feuille de route, justificatifs, factures, rapports, déclarations",
                      "Exécution du contrat qui nous lie (art. 6.1.b)",
                    ],
                    [
                      "Répondre à vos questions fiscales, avec ou sans compte",
                      "Exécution du contrat, ou intérêt légitime à fournir le service demandé (art. 6.1.b et 6.1.f)",
                    ],
                    [
                      "Vérifier une immatriculation auprès des registres publics",
                      "Exécution du contrat (art. 6.1.b)",
                    ],
                    [
                      "Assurer la sécurité du service et prévenir les abus",
                      "Intérêt légitime (art. 6.1.f)",
                    ],
                    [
                      "Améliorer la fiabilité des réponses à partir de statistiques agrégées",
                      "Intérêt légitime (art. 6.1.f) — sans réutilisation du contenu de vos documents",
                    ],
                  ].map(([finalite, base]) => (
                    <tr key={finalite} className="border-b border-border/60 align-top last:border-0">
                      <td className="py-4 pr-5 text-foreground">{finalite}</td>
                      <td className="py-4 pr-5">{base}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 4. Destinataires */}
          <Section icone={Globe2} titre="4. Qui d'autre y a accès">
            <p>
              Vos données ne sont ni vendues, ni louées, ni transmises à des fins commerciales.
              Elles sont en revanche traitées par les prestataires techniques sans lesquels le
              service ne fonctionnerait pas — chacun agissant sur nos instructions et pour la seule
              finalité indiquée.
            </p>
            <div className="space-y-4">
              {DESTINATAIRES.map((d) => (
                <div
                  key={d.nom}
                  className="rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-medium text-foreground">{d.nom}</h3>
                    <span
                      className={
                        d.horsUe
                          ? "rule-label shrink-0 rounded-full border border-border px-2.5 py-1 text-foreground"
                          : "rule-label shrink-0 text-muted-foreground"
                      }
                    >
                      {d.lieu}
                    </span>
                  </div>
                  <p className="mt-2">{d.role}</p>
                  <p className="mt-1.5 text-xs">{d.donnees}</p>
                </div>
              ))}
            </div>

            <p className="pt-2">
              Par ailleurs, certaines actions que vous déclenchez interrogent des services publics
              ou ouverts. Ils reçoivent alors uniquement ce qui est nécessaire à la réponse :
            </p>
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <dl className="divide-y divide-border/60">
                {SERVICES_PUBLICS.map(([service, envoye]) => (
                  <div key={service} className="px-5 py-4 sm:px-6">
                    <dt className="font-medium text-foreground">{service}</dt>
                    <dd className="mt-1.5">{envoye}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-xs">
              La lecture d&apos;un SIRET ou d&apos;un avis de situation est effectuée{" "}
              <span className="font-medium text-foreground">sur notre propre infrastructure</span>,
              sans envoi à un service d&apos;intelligence artificielle.
            </p>
          </Section>

          {/* 5. Transferts */}
          <Section icone={Globe2} titre="5. Transferts en dehors de l'Union européenne">
            <p>
              Deux traitements sortent de l&apos;Union européenne, et nous préférons le dire
              précisément plutôt que de le noyer dans une formule générale :
            </p>
            <ul className="ml-4 list-disc space-y-2 marker:text-accent">
              <li>
                <span className="font-medium text-foreground">Google (Gemini)</span> intervient sur
                la compréhension de vos réponses au questionnaire de diagnostic, et sur la levée
                d&apos;ambiguïté lorsqu&apos;un document de registre est mal lu. Vos factures, vos
                relevés et vos conversations avec l&apos;assistant fiscal{" "}
                <span className="font-medium text-foreground">ne passent pas</span> par ce service.
              </li>
              <li>
                <span className="font-medium text-foreground">Pinecone</span> héberge l&apos;index
                de notre documentation produit. Aucune donnée vous concernant n&apos;y figure.
              </li>
            </ul>
            <p>
              Ces transferts sont encadrés par les garanties prévues au chapitre V du RGPD, en
              particulier les clauses contractuelles types de la Commission européenne. Vous pouvez
              en demander le détail à l&apos;adresse indiquée en section 1.
            </p>
          </Section>

          {/* 6. Durées */}
          <Section icone={Clock} titre="6. Combien de temps">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <ul className="divide-y divide-border/60">
                {DUREES.map((d) => (
                  <li key={d.quoi} className="px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="font-medium text-foreground">{d.quoi}</h3>
                      <span className="num shrink-0 text-xs text-foreground">{d.combien}</span>
                    </div>
                    <p className="mt-1.5">{d.precision}</p>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs">
              Certains documents peuvent devoir être conservés au-delà lorsqu&apos;une obligation
              légale l&apos;impose, notamment en matière de facturation. Le cas échéant, ils sont
              archivés et non plus utilisés dans le service.
            </p>
          </Section>

          {/* 7. Sécurité */}
          <Section icone={Lock} titre="7. Comment ces données sont protégées">
            <ul className="ml-4 list-disc space-y-2 marker:text-accent">
              <li>
                Les mots de passe ne sont jamais conservés en clair : seule une empreinte
                cryptographique non réversible est stockée.
              </li>
              <li>
                Votre session de connexion est portée par un cookie sécurisé, illisible par les
                scripts de la page : même en cas de code malveillant injecté dans le site, elle ne
                peut pas être dérobée.
              </li>
              <li>
                Chaque dossier est cloisonné par compte. Les documents, factures et rapports sont
                systématiquement filtrés par utilisateur, y compris la détection de doublons.
              </li>
              <li>Les échanges avec le service sont chiffrés en transit.</li>
              <li>
                L&apos;accès aux données de production est limité aux personnes qui en ont besoin
                pour maintenir le service.
              </li>
            </ul>
            <p>
              Si une violation de données susceptible d&apos;engendrer un risque élevé pour vous
              survenait, vous en seriez informé, conformément à l&apos;article 34 du RGPD.
            </p>
          </Section>

          {/* 8. Ce que LedgerMind ne fait pas */}
          <Section icone={ShieldCheck} titre="8. Ce que LedgerMind ne fait pas">
            <ul className="ml-4 list-disc space-y-2 marker:text-accent">
              <li>
                Aucune transmission à l&apos;administration fiscale : vous restez seul déclarant.
              </li>
              <li>Aucune connexion à vos comptes bancaires, aucun accès à vos opérations.</li>
              <li>Aucune revente, location ou mise à disposition commerciale de vos données.</li>
              <li>
                Aucune réutilisation du contenu de vos documents pour entraîner des modèles
                d&apos;intelligence artificielle.
              </li>
              <li>
                Aucune décision produisant des effets juridiques n&apos;est prise automatiquement à
                votre égard : les analyses, seuils et recommandations sont des aides à la décision,
                que vous restez libre de suivre ou non.
              </li>
            </ul>
          </Section>

          {/* 9. Droits */}
          <Section icone={FileText} titre="9. Vos droits">
            <p>
              Vous disposez, sur les données vous concernant, des droits suivants : accès,
              rectification, effacement, limitation, opposition, et portabilité (articles 15 à 22 du
              RGPD). Vous pouvez également définir des directives sur leur sort après votre décès.
            </p>
            <p>
              Ces droits s&apos;exercent à l&apos;adresse{" "}
              <a
                href={`mailto:${CONTACT}`}
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                {CONTACT}
              </a>
              . Une réponse vous est apportée dans un délai d&apos;un mois. Une preuve
              d&apos;identité peut être demandée en cas de doute raisonnable — un dossier fiscal ne
              doit pas être communiqué à quelqu&apos;un d&apos;autre.
            </p>
            <p>
              Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL — 3 place de Fontenoy,
              TSA 80715, 75334 Paris Cedex 07 — ou déposer une réclamation depuis son site.
            </p>
          </Section>

          {/* 10. Évolutions */}
          <Section icone={Mail} titre="10. Évolutions de cette politique">
            <p>
              Cette page suit le produit. Toute nouvelle fonctionnalité qui traiterait de nouvelles
              données, ferait appel à un nouveau prestataire ou modifierait une durée de
              conservation y sera reportée avant sa mise en service. La date en haut de page fait
              foi, et une modification substantielle vous sera signalée dans l&apos;application.
            </p>
            <p className="rounded-2xl border border-dashed border-border px-5 py-4">
              LedgerMind fournit une information fiscale documentée et des outils de préparation. Il
              ne se substitue pas à un expert-comptable, et cette page ne constitue pas un conseil
              juridique.
            </p>
          </Section>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Politique de confidentialité — version 1.0, {MAJ}.</p>
          <div className="flex gap-4">
            <Link to="/cookies" className="transition-colors hover:text-foreground">
              Politique cookies
            </Link>
            <Link to="/mes-donnees" className="transition-colors hover:text-foreground">
              Mes données
            </Link>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
