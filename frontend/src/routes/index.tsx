import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  FileText,
  Mic,
  Receipt,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import creatorSecondary from "@/assets/creator-secondary.jpg";
import { HeroVideo } from "@/components/lm/HeroVideo";
import { MarketingLayout } from "@/components/lm/Marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — l'assistant fiscal qui parle humain" },
      {
        name: "description",
        content:
          "LedgerMind aide les freelances et créateurs à comprendre, calculer et provisionner leurs impôts, sans jargon.",
      },
      { property: "og:title", content: "LedgerMind — l'assistant fiscal qui parle humain" },
      {
        property: "og:description",
        content:
          "Diagnostic fiscal conversationnel, échéancier personnalisé, factures et déclarations : tout au même endroit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const PILIERS: { icon: ComponentType<{ className?: string }>; titre: string; texte: string }[] = [
  {
    icon: BookOpen,
    titre: "Une réponse sourcée, jamais un avis en l'air",
    texte:
      "L'agent pédagogue cite le texte fiscal derrière chaque réponse — BOFiP, seuils, barèmes. Vous voyez d'où vient l'information avant de décider.",
  },
  {
    icon: CalendarClock,
    titre: "Vos échéances, à votre calendrier",
    texte:
      "URSSAF, TVA, acomptes : le Centre d'Actions place chaque obligation au bon jour et suit la veille réglementaire qui concerne réellement votre activité.",
  },
  {
    icon: Receipt,
    titre: "Vos documents lus, pas seulement stockés",
    texte:
      "Factures et virements sont analysés ligne à ligne, convertis en équivalent euro, et restent interrogeables : posez vos questions document par document.",
  },
  {
    icon: FileText,
    titre: "De la facture à la déclaration",
    texte:
      "Facture, rapport, déclaration, mise en relation avec un expert-comptable : le parcours complet d'un exercice, sans changer d'outil.",
  },
];

const PARCOURS: { numero: string; titre: string; texte: string }[] = [
  {
    numero: "01",
    titre: "Racontez votre activité",
    texte:
      "Un échange, à l'écrit ou à la voix. Pas de formulaire de quarante champs : l'assistant demande uniquement ce qui change votre situation.",
  },
  {
    numero: "02",
    titre: "Recevez votre diagnostic",
    texte:
      "Régime recommandé, seuils qui vous guettent, cotisations à provisionner. Chaque conclusion est reliée à la règle qui la fonde.",
  },
  {
    numero: "03",
    titre: "Suivez votre feuille de route",
    texte:
      "Les échéances arrivent dans votre agenda, les documents s'analysent tout seuls, et l'expert-comptable prend le relais quand c'est nécessaire.",
  },
];

function LandingPage() {
  return (
    <MarketingLayout>
      <Hero />
      <Preuve />
      <Piliers />
      <Parcours />
      <VoixEtDocuments />
      <AppelFinal />
    </MarketingLayout>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="surface-grain absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="absolute -right-40 -top-40 size-[520px] rounded-full bg-accent/12 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
        <div className="animate-rise">
          <h1 className="mt-6 text-balance text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
            L&apos;assistant fiscal qui{" "}
            <span className="font-normal italic">parle humain.</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
            Comprendre votre régime, anticiper vos échéances, provisionner ce qu&apos;il faut :
            LedgerMind traduit la fiscalité française pour les freelances et les créateurs — sans
            jargon, et avec les sources sous les yeux.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" variant="accent">
              <Link to="/auth">
                Faire mon diagnostic <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/education">Poser une question fiscale</Link>
            </Button>
          </div>

          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-success-ink" />
            Diagnostic gratuit · aucune carte bancaire demandée
          </p>
        </div>

        <div className="animate-rise relative mx-auto w-full max-w-sm [animation-delay:120ms]">
          <div className="surface-ink absolute -inset-4 rounded-[2.5rem] opacity-90 shadow-lift" />
          <div className="relative overflow-hidden rounded-[2rem] border border-ink-foreground/10 bg-ink">
            <HeroVideo className="aspect-9/16 w-full object-cover" />
          </div>
          <div className="absolute -bottom-5 -left-5 rounded-2xl border border-border bg-card p-3 shadow-lift">
            <p className="rule-label text-muted-foreground">À provisionner</p>
            <p className="num mt-1 text-xl font-medium text-foreground">4 128,00 €</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Preuve() {
  const chiffres: { valeur: string; libelle: string }[] = [
    { valeur: "77 700 €", libelle: "Seuil BNC micro suivi en continu" },
    { valeur: "4", libelle: "Échéances majeures anticipées par an" },
    { valeur: "0", libelle: "Ligne de jargon non expliquée" },
  ];
  return (
    <section className="border-y border-border bg-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-3">
        {chiffres.map((c) => (
          <div key={c.libelle}>
            <p className="num text-2xl font-medium text-foreground">{c.valeur}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{c.libelle}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Piliers() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="max-w-2xl">
        <p className="rule-label text-accent-ink">Ce que fait LedgerMind</p>
        <h2 className="mt-3 text-balance text-3xl sm:text-4xl">
          Quatre certitudes, à la place de quatre angoisses.
        </h2>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {PILIERS.map((p) => (
          <article
            key={p.titre}
            className="card-hover rounded-2xl border border-border bg-card p-6"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary/8 text-primary">
              <p.icon className="size-4" />
            </span>
            <h3 className="mt-4 text-lg">{p.titre}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{p.texte}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Parcours() {
  return (
    <section className="border-y border-border bg-secondary/30">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <p className="rule-label text-accent-ink">Le parcours</p>
          <h2 className="mt-3 text-balance text-3xl sm:text-4xl">
            Trois étapes, et vous savez où vous en êtes.
          </h2>
        </div>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {PARCOURS.map((etape) => (
            <li key={etape.numero} className="bg-card p-6">
              <span className="num rounded-lg bg-accent/15 px-2 py-1 text-xs font-medium text-accent-ink">
                {etape.numero}
              </span>
              <h3 className="mt-4 text-lg">{etape.titre}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{etape.texte}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function VoixEtDocuments() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-2">
      <div className="relative overflow-hidden rounded-3xl border border-border">
        <img
          src={creatorSecondary}
          alt="Créatrice indépendante travaillant depuis son bureau"
          className="aspect-4/3 w-full object-cover"
          loading="lazy"
        />
      </div>

      <div>
        <p className="rule-label text-accent-ink">Répondre sans taper</p>
        <h2 className="mt-3 text-balance text-3xl sm:text-4xl">
          Le diagnostic se fait aussi <span className="font-normal italic">à la voix.</span>
        </h2>
        <p className="mt-5 text-pretty text-sm leading-relaxed text-muted-foreground">
          Activez le mode vocal : l&apos;assistant lit chaque question à voix haute, écoute votre
          réponse, vous montre ce qu&apos;il a compris, puis passe à la suite. Tout se passe dans
          votre navigateur — rien n&apos;est envoyé ailleurs pour être transcrit.
        </p>

        <ul className="mt-8 space-y-4">
          {[
            { icon: Mic, texte: "Question lue à voix haute, texte révélé au même rythme." },
            { icon: Receipt, texte: "Transcription affichée en direct avant validation." },
            { icon: Users, texte: "Un mode texte classique reste disponible à tout moment." },
          ].map((item) => (
            <li key={item.texte} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-ink">
                <item.icon className="size-3.5" />
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{item.texte}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AppelFinal() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24">
      <div className="surface-ink relative overflow-hidden rounded-3xl px-8 py-14 text-center shadow-lift sm:px-14">
        <div aria-hidden className="surface-grain absolute inset-0 opacity-50" />
        <div
          aria-hidden
          className="absolute -bottom-32 left-1/2 size-[400px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-2xl">
          <p className="rule-label text-accent">Commencer</p>
          <h2 className="mt-4 text-balance text-3xl text-ink-foreground sm:text-4xl">
            Dix minutes de conversation, et votre année fiscale devient lisible.
          </h2>
          <p className="mt-5 text-pretty text-sm leading-relaxed text-ink-foreground/70">
            Le diagnostic est gratuit et sans engagement. Vous repartez avec votre régime
            recommandé, vos seuils, et votre première feuille de route.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="accent">
              <Link to="/auth">
                Créer mon compte <ArrowRight />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-ink-foreground/25 bg-transparent text-ink-foreground hover:border-ink-foreground/60 hover:bg-ink-foreground/10"
            >
              <Link to="/education">Explorer l&apos;Éducation</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
