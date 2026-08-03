import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  Compass,
  Euro,
  Instagram,
  Receipt,
  ShieldCheck,
  Users,
  Youtube,
} from "lucide-react";
import type { ReactNode } from "react";
import { HeroVideo } from "@/components/lm/HeroVideo";
import { MarketingLayout } from "@/components/lm/Marketing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.84-2.48V9.77a5.7 5.7 0 1 0 4.93 5.64V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.24-1.48Z" />
    </svg>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Micro-titre de section : filet safran puis capitales espacées. */
function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("rule-label text-muted-foreground", className)}>
      <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
      {children}
    </p>
  );
}

function Pastille({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Décor du héros, sur le fond parchemin de la page : grain de points, veines de données cyan
 * et filigranes fiscaux, tous très dilués. Purement décoratif, donc entièrement `aria-hidden`.
 */
function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Grain de points, en encre légère sur le parchemin */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, var(--primary) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Veines de données, côté droit */}
      <svg
        className="absolute inset-y-0 right-0 hidden h-full w-[55%] opacity-[0.1] lg:block"
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

      {/* Halos colorés, très dilués */}
      <div className="absolute -right-[15%] -top-[25%] size-[700px] rounded-full bg-accent opacity-[0.1] blur-[160px]" />
      <div className="absolute bottom-[-20%] left-[0%] size-[420px] rounded-full bg-success opacity-[0.08] blur-[180px]" />

      {/* Filigranes fiscaux */}
      <Euro className="absolute left-[4%] top-[24%] size-40 -rotate-12 text-primary/[0.04]" />
      <Receipt className="absolute bottom-[16%] left-[9%] size-36 rotate-6 text-primary/[0.04]" />
      <Calculator className="absolute bottom-[40%] left-[1%] size-32 -rotate-12 text-primary/[0.04]" />
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <MarketingLayout>
      {/* ---------- Héros ---------- */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 pb-24 pt-20 sm:pt-28 lg:grid-cols-[1.05fr_400px]">
          <div className="animate-rise">
            <h1 className="text-[clamp(2.4rem,6vw,4.5rem)] leading-[0.95] text-foreground">
              Votre fiscalité,
              <br />
              <span className="text-safran italic">enfin lisible.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Vous filmez, vous publiez, vous encaissez. LedgerMind s&apos;occupe du reste :
              réponses sourcées, immatriculation, feuille de route, factures et expert-comptable.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="rule-label text-muted-foreground">Vos revenus</span>
              {[
                { Icon: TikTokIcon, label: "TikTok" },
                { Icon: Instagram, label: "Instagram" },
                { Icon: Youtube, label: "YouTube" },
              ].map(({ Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-semibold text-foreground shadow-soft"
                >
                  <Icon className="size-4 text-accent" />
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="accent">
                <Link to="/education">
                  Poser une question <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/premium">Voir l&apos;offre Premium</Link>
              </Button>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4 text-success-ink" />
              Assistant fiscal ouvert sans compte · Premium pour agir
            </p>
          </div>

          {/* Téléphone — vidéo créatrice */}
          <div className="animate-rise relative mx-auto w-[260px] sm:w-[300px]">
            <div
              className="absolute -inset-6 -z-10 rounded-[3rem] bg-linear-to-br from-accent/30 to-info/20 blur-2xl"
              aria-hidden
            />
            <div className="relative aspect-9/16 overflow-hidden rounded-[2.2rem] border-[6px] border-ink bg-ink shadow-lift">
              <HeroVideo className="absolute inset-0 size-full object-cover" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 text-[11px] font-semibold text-ink-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-2 py-0.5">
                  <span className="size-1.5 rounded-full bg-ink-foreground" /> LIVE
                </span>
                <TikTokIcon className="size-4" />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-ink to-transparent p-4">
                <p className="text-xs text-ink-foreground/80">Revenus de la vidéo</p>
                <p className="num text-lg text-ink-foreground">+ 1 240 €</p>
              </div>
            </div>

            {/* Vignette fiscale flottante */}
            <div className="animate-seal absolute -left-16 bottom-24 hidden rounded-2xl border border-border bg-card p-4 shadow-lift sm:block">
              <p className="rule-label text-muted-foreground">TVA estimée</p>
              <p className="num text-xl font-semibold text-foreground">206,67 €</p>
              <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-3/4 bg-info" />
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* ---------- Gratuit vs Premium ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionLabel>Deux niveaux, une seule logique</SectionLabel>
        <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
          Comprendre est gratuit. Agir, c&apos;est Premium.
        </h2>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Card className="animate-rise p-8">
            <Pastille>Sans compte</Pastille>
            <h3 className="mt-5 text-2xl">Assistant fiscal complet</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Un assistant sérieux, nourri du BOFiP et de sources officielles. Micro-entreprise,
              TVA, seuils, charges, obligations déclaratives : demandez, il cite ses sources et
              signale les textes périmés. Aucune inscription requise.
            </p>
            <Link
              to="/education"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground underline decoration-accent underline-offset-4"
            >
              Explorer l&apos;Assistant fiscal <ArrowRight className="size-4" />
            </Link>
          </Card>

          <Card className="animate-rise surface-ink overflow-hidden border-0 p-8">
            <Pastille className="border-ink-foreground/30 bg-ink-foreground text-ink">
              Formule Premium
            </Pastille>
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
            <Button asChild variant="accent" className="mt-7">
              <Link to="/premium">
                Découvrir Premium <ArrowRight />
              </Link>
            </Button>
          </Card>
        </div>
      </section>

      {/* ---------- Piliers ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: BookOpen,
              title: "Assistant fiscal",
              text: "Réponses sourcées, fraîcheur des textes vérifiée, historique de conversation.",
            },
            {
              icon: Compass,
              title: "Mise en route",
              text: "Avec SIREN : vérification officielle. Sans SIREN : diagnostic en quelques minutes.",
            },
            {
              icon: Receipt,
              title: "Justificatifs",
              text: "Factures et virements lus ligne à ligne, doublons et incohérences signalés.",
            },
            {
              icon: Users,
              title: "Expert-comptable",
              text: "Des emails personnalisés à des cabinets, générés depuis votre profil.",
            },
          ].map((p) => (
            <Card
              key={p.title}
              className="animate-rise p-6 transition-transform hover:-translate-y-1"
            >
              <p.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-lg">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------- Appel final ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <Card className="flex flex-col items-start gap-6 p-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl">Commencez par une question.</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              « Dois-je facturer la TVA cette année ? » — c&apos;est souvent là que tout démarre.
            </p>
          </div>
          <Button asChild size="lg" variant="accent">
            <Link to="/education">
              Poser ma question <ArrowRight />
            </Link>
          </Button>
        </Card>
      </section>
    </MarketingLayout>
  );
}
