import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Compass,
  Receipt,
  Users,
  ShieldCheck,
  Instagram,
  Youtube,
  Calculator,
  Euro,
} from "lucide-react";
import { MarketingLayout } from "@/components/marketing";
import { HeroVideo } from "@/components/hero-video";
import { ButtonLink, Card, SectionLabel, Badge } from "@/components/ui-kit";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.84-2.48V9.77a5.7 5.7 0 1 0 4.93 5.64V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.24-1.48Z" />
    </svg>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Subtle dot grain on the deep ink */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--ink-foreground) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Large parchment ledger shape on the right */}
      <div
        className="absolute -top-[10%] -right-[10%] hidden h-[130%] w-[72%] rotate-3 skew-x-[-6deg] rounded-[80px] bg-background opacity-95 shadow-[0_0_100px_rgba(0,0,0,0.45)] lg:block"
        style={{ backgroundColor: "var(--background)" }}
      >
        {/* Parchment texture lines */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, var(--primary) 2px, var(--primary) 3px)",
            backgroundSize: "100% 4px",
          }}
        />
        {/* Cold cyan data veins */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.14]"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
        >
          <line x1="800" y1="0" x2="800" y2="1000" stroke="var(--info)" strokeWidth="1" />
          <line x1="0" y1="200" x2="1000" y2="200" stroke="var(--info)" strokeWidth="1" />
          <circle cx="800" cy="200" r="8" fill="var(--info)" />
          <line x1="750" y1="0" x2="750" y2="1000" stroke="var(--info)" strokeWidth="0.5" />
          <line x1="0" y1="250" x2="1000" y2="250" stroke="var(--info)" strokeWidth="0.5" />
          <line x1="0" y1="450" x2="1000" y2="450" stroke="var(--info)" strokeWidth="0.5" />
          <circle cx="750" cy="250" r="5" fill="var(--info)" />
        </svg>
      </div>

      {/* Deep ink blots */}
      <div className="absolute -left-[10%] -top-[20%] size-[800px] rounded-full bg-ink blur-[150px] opacity-80" />
      <div className="absolute bottom-[-10%] left-[5%] size-[420px] rounded-full bg-accent blur-[180px] opacity-[0.12]" />

      {/* Giant fiscal watermark icons on the ink side */}
      <Euro className="absolute left-[6%] top-[28%] size-40 -rotate-12 text-ink-foreground/[0.05]" />
      <Receipt className="absolute bottom-[18%] left-[10%] size-36 rotate-6 text-ink-foreground/[0.05]" />
      <Calculator className="absolute left-[2%] bottom-[38%] size-32 -rotate-12 text-ink-foreground/[0.05]" />

      {/* Ink scrim over the left half so the hero text stays readable above the parchment */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-transparent lg:via-ink/55" />
    </div>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — Copilote fiscal des indépendants et créateurs" },
      {
        name: "description",
        content:
          "Posez vos questions fiscales et obtenez des réponses sourcées BOFiP. Passez Premium pour votre parcours d'immatriculation, votre feuille de route et vos factures analysées.",
      },
      { property: "og:title", content: "LedgerMind — Copilote fiscal des indépendants" },
      {
        property: "og:description",
        content: "Comprendre sa fiscalité, gratuitement. Agir dessus, avec Premium.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <MarketingLayout>
      {/* ---------- Hero : encre & parchemin ---------- */}
      <section className="relative overflow-hidden bg-ink">
        <HeroBackdrop />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 pb-24 pt-20 sm:pt-28 lg:grid-cols-[1.05fr_400px]">
          <div className="animate-rise">
            <h1 className="text-[clamp(2.4rem,6vw,4.5rem)] leading-[0.95] text-ink-foreground">
              Votre fiscalité,
              <br />
              <span className="italic text-safran">enfin lisible.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-foreground/70">
              Vous filmez, vous publiez, vous encaissez. LedgerMind s'occupe du reste : réponses
              sourcées, immatriculation, feuille de route, factures et expert-comptable.
            </p>

            {/* Plateformes */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="rule-label text-ink-foreground/60">Vos revenus</span>
              {[
                { Icon: TikTokIcon, label: "TikTok" },
                { Icon: Instagram, label: "Instagram" },
                { Icon: Youtube, label: "YouTube" },
              ].map(({ Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-ink-foreground/10 bg-ink-foreground/[0.06] px-3.5 py-1.5 text-sm font-semibold text-ink-foreground shadow-soft backdrop-blur-sm"
                >
                  <Icon className="size-4 text-accent" />
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink to="/education" variant="safran" size="lg">
                Poser une question <ArrowRight />
              </ButtonLink>
              <ButtonLink to="/abonnement" variant="onInk" size="lg">
                Voir l'offre Premium
              </ButtonLink>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-ink-foreground/60">
              <ShieldCheck className="size-4 text-success" />
              Éducation ouverte sans compte · Premium pour agir
            </p>
          </div>

          {/* Téléphone — petite vidéo créatrice */}
          <div className="animate-rise relative mx-auto w-[260px] sm:w-[300px]">
            <div
              className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-accent/30 to-info/20 blur-2xl"
              aria-hidden
            />
            <div className="relative aspect-[9/16] overflow-hidden rounded-[2.2rem] border-[6px] border-ink bg-ink shadow-lift">
              <HeroVideo className="absolute inset-0 size-full object-cover" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 text-[11px] font-semibold text-ink-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-2 py-0.5">
                  <span className="size-1.5 rounded-full bg-ink-foreground" /> LIVE
                </span>
                <TikTokIcon className="size-4" />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink to-transparent p-4">
                <p className="text-xs text-ink-foreground/80">Revenus de la vidéo</p>
                <p className="font-mono text-lg text-ink-foreground">+ 1 240 €</p>
              </div>
            </div>

            {/* Floating fiscal widgets */}
            <div className="animate-seal absolute -left-16 bottom-24 hidden rounded-2xl border border-border bg-card p-4 shadow-lift sm:block">
              <p className="rule-label text-muted-foreground">TVA estimée</p>
              <p className="text-xl font-semibold text-foreground">206,67 €</p>
              <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-3/4 bg-info" />
              </div>
            </div>
          </div>
        </div>

        {/* Soft blend into the light page below */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" aria-hidden />
      </section>

      {/* ---------- Free vs Premium ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionLabel>Deux niveaux, une seule logique</SectionLabel>
        <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
          Comprendre est gratuit. Agir, c'est Premium.
        </h2>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Card className="animate-rise p-8">
            <Badge>Sans compte</Badge>
            <h3 className="mt-5 text-2xl">Éducation fiscale complète</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Un assistant sérieux, nourri du BOFiP et de sources officielles. Micro-entreprise, TVA, seuils,
              charges, obligations déclaratives : demandez, il cite ses sources et signale les textes périmés.
              Aucune inscription requise.
            </p>
            <Link
              to="/education"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground underline decoration-accent underline-offset-4"
            >
              Explorer l'Éducation <ArrowRight className="size-4" />
            </Link>
          </Card>

          <Card className="animate-rise surface-ink overflow-hidden border-0 p-8">
            <Badge className="border-white/30 bg-white text-ink">Formule Premium</Badge>
            <h3 className="mt-5 text-2xl text-ink-foreground">Le parcours fiscal complet</h3>
            <ul className="mt-5 space-y-3 text-sm text-ink-foreground/80">
              {[
                "Vérification SIRET et immatriculation guidée",
                "Diagnostic sans SIREN + feuille de route déterministe",
                "Analyse de factures et virements, incohérences détectées",
                "Emails prêts à envoyer à des cabinets près de chez vous",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  {t}
                </li>
              ))}
            </ul>
            <ButtonLink to="/abonnement" variant="safran" className="mt-7">
              Découvrir Premium <ArrowRight />
            </ButtonLink>
          </Card>
        </div>
      </section>

      {/* ---------- Piliers ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: BookOpen,
              title: "Éducation",
              text: "Réponses sourcées, fraîcheur des textes vérifiée, historique de conversation.",
            },
            {
              icon: Compass,
              title: "Parcours",
              text: "Avec SIREN : vérification officielle. Sans SIREN : diagnostic en quelques minutes.",
            },
            {
              icon: Receipt,
              title: "Capture",
              text: "Factures et virements lus ligne à ligne, doublons et incohérences signalés.",
            },
            {
              icon: Users,
              title: "Cabinets",
              text: "Des emails personnalisés à des experts-comptables, générés depuis votre profil.",
            },
          ].map((p) => (
            <Card key={p.title} className="animate-rise p-6 transition-transform hover:-translate-y-1">
              <p.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-lg">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------- CTA final ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <Card className="flex flex-col items-start gap-6 p-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl">Commencez par une question.</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              « Dois-je facturer la TVA cette année ? » — c'est souvent là que tout démarre.
            </p>
          </div>
          <ButtonLink to="/education" variant="safran" size="lg">
            Poser ma question <ArrowRight />
          </ButtonLink>
        </Card>
      </section>
    </MarketingLayout>
  );
}
