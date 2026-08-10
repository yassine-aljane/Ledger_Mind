import { createFileRoute, Link } from "@tanstack/react-router";
import { Cookie, Database, Globe, Mail, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { MarketingLayout } from "@/components/lm/Marketing";
import { GROUPES, type Groupe, type Support } from "@/lib/traceurs";

/**
 * Politique Cookies et traceurs (RGPD / ePrivacy).
 *
 * L'inventaire affiché vient de `lib/traceurs.ts`, partagé avec l'écran `/mes-donnees` : deux
 * listes séparées auraient dérivé, et une politique qui décrit des traceurs inexistants — ou qui
 * en oublie — est aussi fautive qu'une politique absente. Toute nouvelle clé de stockage doit donc
 * être ajoutée au catalogue en même temps qu'elle est introduite dans le code.
 *
 * Aucun bandeau de consentement n'est affiché, et c'est un choix documenté (§ « Pourquoi aucune
 * fenêtre de consentement ») : tous les traceurs listés sont strictement nécessaires au service
 * demandé, donc exemptés de consentement préalable. Ajouter un jour une mesure d'audience ou un
 * traceur publicitaire imposerait de recueillir le consentement AVANT dépôt.
 */

/** Date de dernière révision, affichée en tête et en pied de page. */
const MAJ = "10 août 2026";

/** À remplacer par l'adresse de contact réelle avant mise en ligne. */
const CONTACT = "privacy@ledgermind.fr";

const NAVIGATEURS: Array<[string, string]> = [
  ["Chrome", "Paramètres → Confidentialité et sécurité → Cookies et autres données des sites"],
  ["Firefox", "Paramètres → Vie privée et sécurité → Cookies et données de sites"],
  ["Safari", "Réglages → Confidentialité → Gérer les données de sites web"],
  ["Edge", "Paramètres → Cookies et autorisations de site"],
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
  icone: typeof Cookie;
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

/** Badge de support — le lecteur doit voir d'un coup d'œil ce qui est un cookie et ce qui n'en est pas un. */
function SupportBadge({ support }: { support: Support }) {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap">
      {support}
    </span>
  );
}

function TableauTraceurs({ groupe }: { groupe: Groupe }) {
  return (
    <div className="animate-rise rounded-2xl border border-border bg-card shadow-soft">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <h3 className="text-lg">{groupe.titre}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{groupe.intro}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="rule-label px-5 py-3 text-muted-foreground sm:px-6">
                Nom
              </th>
              <th scope="col" className="rule-label px-5 py-3 text-muted-foreground">
                Support
              </th>
              <th scope="col" className="rule-label px-5 py-3 text-muted-foreground">
                À quoi il sert
              </th>
              <th scope="col" className="rule-label px-5 py-3 text-muted-foreground sm:px-6">
                Durée
              </th>
            </tr>
          </thead>
          <tbody>
            {groupe.traceurs.map((t) => (
              <tr key={t.nom} className="border-b border-border/60 align-top last:border-0">
                <th scope="row" className="px-5 py-4 font-normal sm:px-6">
                  <code className="num text-xs break-all">{t.nom}</code>
                </th>
                <td className="px-5 py-4">
                  <SupportBadge support={t.support} />
                </td>
                <td className="px-5 py-4 text-muted-foreground">{t.finalite}</td>
                <td className="px-5 py-4 text-muted-foreground">{t.duree}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Politique Cookies — LedgerMind" },
      {
        name: "description",
        content:
          "Les traceurs utilisés par LedgerMind, leur finalité, leur durée, et comment les supprimer. Aucun cookie publicitaire, aucune mesure d'audience.",
      },
      { property: "og:title", content: "Politique Cookies — LedgerMind" },
      {
        property: "og:description",
        content:
          "Traceurs strictement nécessaires uniquement : ce qu'ils font, combien de temps, et comment les effacer.",
      },
    ],
  }),
  component: PolitiqueCookies,
});

function PolitiqueCookies() {
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-5 py-14 sm:py-20">
        {/* En-tête */}
        <header className="animate-rise max-w-2xl">
          <SectionLabel>Confidentialité</SectionLabel>
          <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.05]">
            Politique <span className="text-safran italic">Cookies</span>
          </h1>
          <p className="mt-5 text-muted-foreground">
            Cette page décrit tout ce que LedgerMind dépose sur votre appareil : à quoi chaque
            élément sert, combien de temps il reste, et comment vous en débarrasser.
          </p>
          <p className="num mt-4 text-xs text-muted-foreground">
            Dernière mise à jour : {MAJ} · Version 1.0
          </p>
        </header>

        {/* Résumé — l'essentiel doit être lisible sans dérouler la page. */}
        <div className="animate-rise surface-ink mt-10 rounded-2xl p-6 text-ink-foreground sm:p-8">
          <p className="rule-label text-safran">En deux phrases</p>
          <p className="mt-4 leading-relaxed">
            LedgerMind n&apos;utilise{" "}
            <span className="font-semibold">aucun cookie publicitaire</span>,{" "}
            <span className="font-semibold">aucune mesure d&apos;audience</span> et{" "}
            <span className="font-semibold">aucun traceur tiers de suivi</span>.
          </p>
          <p className="mt-3 leading-relaxed text-ink-foreground/75">
            Les seuls éléments enregistrés servent à vous garder connecté, à conserver votre
            parcours en cours et à retenir vos préférences d&apos;affichage. C&apos;est aussi la
            raison pour laquelle aucune fenêtre de consentement ne vous barre la route.
          </p>
        </div>

        <div className="mt-14 space-y-14">
          {/* 1. Définitions */}
          <Section icone={Cookie} titre="1. De quoi parle-t-on ?">
            <p>
              Un <span className="font-medium text-foreground">cookie</span> est un petit fichier
              déposé par un site dans votre navigateur, et renvoyé à chaque visite. À côté des
              cookies, un site peut aussi écrire des informations dans deux espaces de rangement du
              navigateur :
            </p>
            <ul className="ml-4 list-disc space-y-2 marker:text-accent">
              <li>
                <span className="font-medium text-foreground">le stockage local</span> — les
                informations restent tant que vous ne les effacez pas ;
              </li>
              <li>
                <span className="font-medium text-foreground">le stockage de session</span> — tout
                disparaît à la fermeture de l&apos;onglet.
              </li>
            </ul>
            <p>
              La réglementation traite ces trois mécanismes de la même façon : ce sont des{" "}
              <span className="font-medium text-foreground">traceurs</span>. LedgerMind les décrit
              donc tous ici, sans distinction — c&apos;est ce qui est écrit sur votre appareil qui
              compte, pas la technique employée.
            </p>
          </Section>

          {/* 2. Inventaire */}
          <Section icone={Database} titre="2. Ce que LedgerMind enregistre exactement">
            <p>
              L&apos;inventaire ci-dessous est exhaustif. Chaque élément est{" "}
              <span className="font-medium text-foreground">strictement nécessaire</span> au
              fonctionnement du service que vous demandez : aucun ne sert à vous suivre d&apos;un
              site à l&apos;autre, ni à construire un profil publicitaire.
            </p>
            <div className="space-y-5 pt-2">
              {GROUPES.map((groupe) => (
                <TableauTraceurs key={groupe.id} groupe={groupe} />
              ))}
            </div>
            <p className="text-xs">
              Ces éléments restent sur votre appareil. Les données de votre dossier fiscal, elles,
              sont conservées sur nos serveurs lorsque vous disposez d&apos;un compte : ce
              traitement relève de la{" "}
              <Link
                to="/confidentialite"
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                politique de confidentialité
              </Link>
              , distincte de la présente page.
            </p>
          </Section>

          {/* 3. Ce qui n'existe pas — un engagement vérifiable vaut mieux qu'une formule vague. */}
          <Section icone={ShieldCheck} titre="3. Ce que LedgerMind ne fait pas">
            <ul className="ml-4 list-disc space-y-2 marker:text-accent">
              <li>
                Aucun cookie publicitaire, aucun pixel de reciblage, aucun réseau social intégré.
              </li>
              <li>
                Aucun outil de mesure d&apos;audience, y compris anonymisé (ni Google Analytics, ni
                équivalent).
              </li>
              <li>Aucun suivi de votre navigation en dehors de LedgerMind.</li>
              <li>Aucune revente ni mise à disposition de vos données à des fins commerciales.</li>
              <li>
                Aucune décision automatisée fondée sur un profilage publicitaire vous concernant.
              </li>
            </ul>
            <p>
              Si un outil de mesure d&apos;audience devait un jour être ajouté, il ne serait déposé
              qu&apos;<span className="font-medium text-foreground">après</span> votre consentement,
              recueilli par une fenêtre où refuser est aussi simple qu&apos;accepter — et cette page
              serait mise à jour avant toute mise en service.
            </p>
          </Section>

          {/* 4. Tiers */}
          <Section icone={Globe} titre="4. Services tiers appelés par les pages">
            <p>
              Deux services extérieurs sont sollicités pour afficher les pages. Ils{" "}
              <span className="font-medium text-foreground">ne déposent aucun traceur</span>, mais
              recevoir une requête implique de connaître l&apos;adresse IP qui l&apos;émet — la
              transparence impose donc de les mentionner.
            </p>
            <div className="grid gap-4 pt-1 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <p className="rule-label text-muted-foreground">Google Fonts</p>
                <p className="mt-3 text-sm leading-relaxed">
                  Fournit les polices de caractères du site (
                  <code className="num text-xs">fonts.googleapis.com</code>,{" "}
                  <code className="num text-xs">fonts.gstatic.com</code>). Sollicité à
                  l&apos;affichage de chaque page. Aucun cookie n&apos;est déposé ; votre adresse IP
                  et les caractéristiques de votre navigateur sont transmises à Google.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <p className="rule-label text-muted-foreground">OpenStreetMap</p>
                <p className="mt-3 text-sm leading-relaxed">
                  Fournit le fond de carte de la recherche d&apos;expert-comptable (
                  <code className="num text-xs">tile.openstreetmap.org</code>). Sollicité{" "}
                  <span className="font-medium text-foreground">uniquement</span> quand vous ouvrez
                  cette carte. Aucun cookie n&apos;est déposé ; votre adresse IP est transmise à la
                  fondation OpenStreetMap.
                </p>
              </div>
            </div>
            <p className="text-xs">
              Le traitement effectué par ces prestataires relève de leurs propres politiques de
              confidentialité, consultables sur leurs sites respectifs.
            </p>
          </Section>

          {/* 5. Consentement */}
          <Section icone={ShieldCheck} titre="5. Pourquoi aucune fenêtre de consentement ?">
            <p>
              La réglementation impose de recueillir votre accord avant de déposer un traceur —{" "}
              <span className="font-medium text-foreground">sauf</span> lorsque celui-ci est
              strictement nécessaire à la fourniture du service que vous demandez. C&apos;est
              l&apos;exception prévue par l&apos;article 82 de la loi Informatique et Libertés, dans
              la lecture qu&apos;en donne la CNIL.
            </p>
            <p>
              Tous les traceurs listés en section 2 relèvent de cette exception : sans eux, la
              connexion, le parcours et l&apos;affichage ne fonctionnent pas. Aucun consentement
              n&apos;est donc requis, et vous imposer une fenêtre à cliquer serait une formalité
              vide de sens.
            </p>
            <p>
              Le traitement des données associées repose sur l&apos;exécution du contrat qui nous
              lie (article 6.1.b du RGPD) pour ce qui touche au compte et au parcours, et sur notre
              intérêt légitime à fournir une interface qui fonctionne (article 6.1.f) pour les
              préférences d&apos;affichage.
            </p>
          </Section>

          {/* 6. Gestion */}
          <Section icone={SlidersHorizontal} titre="6. Supprimer ou refuser ces éléments">
            <p>
              Le plus simple est l&apos;écran{" "}
              <Link
                to="/mes-donnees"
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                Mes données sur cet appareil
              </Link>{" "}
              : il affiche ce qui est réellement enregistré chez vous, en direct, et permet de tout
              effacer en un clic.
            </p>
            <p>Vous pouvez aussi passer par les réglages de votre navigateur :</p>
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <dl className="divide-y divide-border/60">
                {NAVIGATEURS.map(([navigateur, chemin]) => (
                  <div
                    key={navigateur}
                    className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-5"
                  >
                    <dt className="w-24 shrink-0 text-sm font-medium text-foreground">
                      {navigateur}
                    </dt>
                    <dd className="text-sm text-muted-foreground">{chemin}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p>
              La navigation privée est une autre option : tout est effacé à la fermeture de la
              fenêtre.
            </p>
            <p className="rounded-2xl border border-dashed border-border px-5 py-4">
              <span className="font-medium text-foreground">À savoir avant d&apos;effacer :</span>{" "}
              vous serez déconnecté, vos brouillons de simulation et votre préférence
              d&apos;affichage seront perdus. Si vous bloquez complètement le stockage pour ce site,
              la connexion à un compte devient impossible — l&apos;Assistant fiscal, lui, reste
              accessible sans compte. Aucune donnée déjà enregistrée sur votre dossier en ligne
              n&apos;est affectée par cet effacement local.
            </p>
          </Section>

          {/* 7. Droits */}
          <Section icone={Mail} titre="7. Vos droits et votre contact">
            <p>
              Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de
              limitation, d&apos;opposition et de portabilité sur les données personnelles vous
              concernant (articles 15 à 22 du RGPD). Ces droits s&apos;exercent auprès de :
            </p>
            <p>
              <a
                href={`mailto:${CONTACT}`}
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-safran"
              >
                {CONTACT}
              </a>
            </p>
            <p>
              Si une réponse ne vous satisfait pas, vous pouvez saisir la CNIL — 3 place de
              Fontenoy, TSA 80715, 75334 Paris Cedex 07 — ou déposer une plainte depuis son site.
            </p>
          </Section>

          {/* 8. Évolutions */}
          <Section icone={Cookie} titre="8. Évolutions de cette politique">
            <p>
              Cette page suit le produit : toute nouvelle fonctionnalité qui écrirait quelque chose
              sur votre appareil y sera ajoutée avant sa mise en service. La date de mise à jour en
              haut de page fait foi, et une modification substantielle — en particulier
              l&apos;introduction d&apos;un traceur soumis à consentement — vous sera signalée dans
              l&apos;application.
            </p>
          </Section>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Politique Cookies — version 1.0, {MAJ}.</p>
          <Link to="/" className="transition-colors hover:text-foreground">
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </MarketingLayout>
  );
}
