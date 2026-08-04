import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Compass,
  Gauge,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { HeroVideo } from "@/components/lm/HeroVideo";
import { MarketingLayout } from "@/components/lm/Marketing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("rule-label text-muted-foreground", className)}>
      <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
      {children}
    </p>
  );
}

const SERVICE_GROUPS: {
  n: string;
  title: string;
  tagline: string;
  description: string;
  includes: string[];
  icon: ComponentType<{ className?: string }>;
  access: string;
}[] = [
  {
    n: "01",
    title: "Comprendre",
    tagline: "Questions & sources",
    description:
      "L’Assistant fiscal répond sans compte, cite le BOFiP et signale les textes périmés. La porte d’entrée LedgerMind.",
    includes: ["Assistant fiscal"],
    icon: BookOpen,
    access: "Sans compte",
  },
  {
    n: "02",
    title: "Démarrer",
    tagline: "Profil & mise en route",
    description:
      "Vérification SIREN ou diagnostic rapide, puis un compte qui sauvegarde vos discussions et ouvre les démos.",
    includes: ["Mise en route", "Mon compte"],
    icon: Compass,
    access: "Compte · Premium",
  },
  {
    n: "03",
    title: "Gérer",
    tagline: "Pièces & déclarations",
    description:
      "Justificatifs lus automatiquement, facturation jusqu’à la déclaration, registre des transactions exportable.",
    includes: ["Justificatifs", "Facturation", "Transactions"],
    icon: Receipt,
    access: "Premium",
  },
  {
    n: "04",
    title: "Décider",
    tagline: "Pilotage & entourage",
    description:
      "Vue d’ensemble de votre situation, scénarios « et si… », et mise en relation avec un expert-comptable près de vous.",
    includes: ["Ma situation", "Scénarios", "Expert-comptable"],
    icon: Gauge,
    access: "Premium",
  },
];

const DEMO_QA = [
  {
    q: "Dois-je facturer la TVA cette année ?",
    a: "Tant que vous restez sous le seuil de franchise, non. On surveille votre CA glissant — LedgerMind vous alerte avant le passage.",
  },
  {
    q: "Un sponso TikTok, c'est du BNC ?",
    a: "Oui en général : prestation de services. Les cotisations micro-BNC s'appliquent sur l'encaissé, pas sur le brut plateforme.",
  },
  {
    q: "Je dépasse le plafond micro — que faire ?",
    a: "Deux chemins : bascule au réel simplifié, ou structuration. La Mise en route Premium pose le diagnostic avant de décider.",
  },
] as const;

const OFFICIAL_SOURCES: { name: string; logo: string }[] = [
  { name: "BOFiP", logo: "/sources/bofip.svg" },
  { name: "Légifrance", logo: "/sources/legifrance.svg" },
  { name: "URSSAF", logo: "/sources/urssaf.svg" },
  { name: "impôts.gouv", logo: "/sources/impots.svg" },
  { name: "service-public", logo: "/sources/service-public.svg" },
  { name: "INSEE", logo: "/sources/insee.png" },
  { name: "INPI", logo: "/sources/inpi.svg" },
  { name: "Sirene", logo: "/sources/sirene.png" },
];

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        if (reduced) {
          setValue(to);
          return;
        }
        const start = performance.now();
        const dur = 1200;
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / dur);
          const eased = 1 - (1 - t) ** 3;
          setValue(Math.round(to * eased));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to]);

  return (
    <span ref={ref} className="num">
      {value.toLocaleString("fr-FR")}
      {suffix}
    </span>
  );
}

/** Mini conversation qui tape toute seule — pas une vidéo, une démo vivante. */
function LiveAssistantDemo() {
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState<"typing-q" | "show-q" | "typing-a" | "hold">("typing-q");
  const [typedQ, setTypedQ] = useState("");
  const [typedA, setTypedA] = useState("");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const item = DEMO_QA[qi];
    if (reduced) {
      setTypedQ(item.q);
      setTypedA(item.a);
      setPhase("hold");
      const t = window.setTimeout(() => setQi((i) => (i + 1) % DEMO_QA.length), 5000);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    const timers: number[] = [];

    const run = async () => {
      setPhase("typing-q");
      setTypedQ("");
      setTypedA("");
      for (let i = 0; i <= item.q.length; i++) {
        if (cancelled) return;
        setTypedQ(item.q.slice(0, i));
        await new Promise<void>((r) => {
          timers.push(window.setTimeout(r, 28 + Math.random() * 22));
        });
      }
      setPhase("show-q");
      await new Promise<void>((r) => {
        timers.push(window.setTimeout(r, 420));
      });
      setPhase("typing-a");
      for (let i = 0; i <= item.a.length; i++) {
        if (cancelled) return;
        setTypedA(item.a.slice(0, i));
        await new Promise<void>((r) => {
          timers.push(window.setTimeout(r, 12 + Math.random() * 10));
        });
      }
      setPhase("hold");
      await new Promise<void>((r) => {
        timers.push(window.setTimeout(r, 3200));
      });
      if (!cancelled) setQi((i) => (i + 1) % DEMO_QA.length);
    };

    void run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [qi]);

  return (
    <div className="relative overflow-hidden border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
            <span className="relative inline-flex size-2 rounded-full bg-success-ink" />
          </span>
          <span className="rule-label text-muted-foreground">Assistant fiscal · démo</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {String(qi + 1).padStart(2, "0")}/{String(DEMO_QA.length).padStart(2, "0")}
        </span>
      </div>
      <div className="space-y-4 px-4 py-5 sm:px-5">
        <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground">
          {typedQ}
          {phase === "typing-q" && (
            <span className="animate-caret ml-0.5 inline-block h-3.5 w-0.5 align-middle bg-primary-foreground" />
          )}
        </div>
        {(phase === "typing-a" || phase === "hold" || typedA) && (
          <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-border bg-secondary/60 px-4 py-3 text-sm leading-relaxed text-foreground">
            {typedA}
            {phase === "typing-a" && (
              <span className="animate-caret ml-0.5 inline-block h-3.5 w-0.5 align-middle bg-foreground" />
            )}
            {phase === "hold" && (
              <p className="mt-3 border-t border-border/80 pt-2 font-mono text-[10px] uppercase tracking-wider text-teal-dark">
                Source officielle · non juridiquement conseil
              </p>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-border px-4 py-3">
        <Button asChild variant="accent" size="sm" className="w-full rounded-full sm:w-auto">
          <Link to="/education">
            Essayer avec ma question <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerMind — Copilote fiscal des créateurs et indépendants" },
      {
        name: "description",
        content:
          "Ouvrez l'Assistant fiscal sans compte. Créez un compte gratuit pour sauvegarder vos discussions et voir des démos. Passez Premium pour Mise en route, Justificatifs, Facturation et Expert-comptable.",
      },
      { property: "og:title", content: "LedgerMind — Copilote fiscal des créateurs" },
      {
        property: "og:description",
        content: "Assistant fiscal gratuit sans inscription. Compte free pour sauver. Premium pour agir.",
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
      {/* ---------- Héros plein cadre (vidéo seule ici) ---------- */}
      <section className="relative min-h-[92vh] overflow-hidden text-ink-foreground">
        <HeroVideo className="absolute inset-0 size-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, color-mix(in oklch, var(--ink) 92%, transparent) 0%, color-mix(in oklch, var(--ink) 72%, transparent) 48%, color-mix(in oklch, var(--ink) 38%, transparent) 100%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.1]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden
        />

        <div className="relative z-10 mx-auto flex min-h-[92vh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 sm:pb-20 sm:pt-32">
          <div className="animate-rise max-w-2xl">
            <p className="font-display text-safran text-lg tracking-wide sm:text-xl">LedgerMind</p>
            <h1 className="mt-3 text-balance font-display text-[clamp(2.4rem,6.5vw,4.4rem)] leading-[0.98]">
              Vos vues montent.{" "}
              <span className="italic text-safran">
                Votre fiscalité&nbsp;aussi  on la traduit.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-foreground/75 sm:text-lg">
              Copilote fiscal pour créateurs : questions sans compte, dossier quand vous êtes
              prêt. Moins de sueurs froides URSSAF, plus de français humain.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="accent" className="rounded-full px-7">
                <Link to="/education">
                  Ouvrir l&apos;Assistant fiscal <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-ink-foreground/35 bg-ink-foreground/5 px-7 text-ink-foreground hover:bg-ink-foreground/12 hover:text-ink-foreground"
              >
                <a href="#parcours">Voir ce que vous débloquez</a>
              </Button>
            </div>

            <p className="mt-6 flex items-center gap-2 text-sm text-ink-foreground/60">
              <ShieldCheck className="size-4 shrink-0 text-accent" />
              Zéro inscription pour commencer · Compte free pour sauver · Premium pour agir
            </p>
          </div>

          <a
            href="#commencer"
            className="animate-seal mt-14 inline-flex w-fit items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-foreground/45 transition-colors hover:text-ink-foreground/80"
          >
            Défiler <ArrowDown className="size-3.5" />
          </a>
        </div>
      </section>

      {/* ---------- Démo conversation vivante ---------- */}
      <section id="commencer" className="relative scroll-mt-24 overflow-hidden">
        <div
          className="pointer-events-none absolute -left-24 top-20 size-72 rounded-full bg-accent/15 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <SectionLabel>Sans compte</SectionLabel>
            <h2 className="mt-4 font-display text-3xl leading-tight sm:text-4xl">
              Une question fiscale.
              <br />
              <span className="italic text-accent-ink">Zéro formalité.</span>
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              L&apos;Assistant tape déjà pour vous à droite — même idée en vrai : vous posez la
              question, il cite ses sources. Pas d&apos;e-mail, pas de carte.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-6">
              <div>
                <p className="num text-2xl text-foreground sm:text-3xl">0&nbsp;€</p>
                <p className="mt-1 text-xs text-muted-foreground">pour démarrer</p>
              </div>
              <div>
                <p className="num text-2xl text-foreground sm:text-3xl">
                  <CountUp to={3} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">niveaux d&apos;accès</p>
              </div>
              <div>
                <p className="num text-2xl text-foreground sm:text-3xl">
                  <CountUp to={4} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">pôles métier</p>
              </div>
            </div>
          </div>
          <div className="animate-slide-up">
            <LiveAssistantDemo />
          </div>
        </div>
      </section>

      {/* ---------- Pôles en grille 2×2 ---------- */}
      <section id="services" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 pt-16 pb-8 sm:pt-20 sm:pb-10">
          <div className="max-w-xl">
            <SectionLabel>Les services</SectionLabel>
            <h2 className="mt-4 font-display text-3xl leading-tight sm:text-4xl">
              Quatre pôles —{" "}
              <span className="italic text-accent-ink">survolez pour ouvrir.</span>
            </h2>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Quatre étapes. Au survol, les services du pôle s&apos;affichent en titres.
            </p>
          </div>

          <ol className="mt-10 grid list-none gap-8 sm:mt-12 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 lg:gap-x-8">
            {SERVICE_GROUPS.map((g, i) => {
              const right = i % 2 === 1;
              return (
                <li key={g.title}>
                  <div
                    className={cn(
                      "group relative w-full max-w-sm cursor-default outline-none",
                      right && "sm:ml-6 sm:text-right lg:ml-10",
                    )}
                    tabIndex={0}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-4 sm:gap-5",
                        right && "sm:flex-row-reverse",
                      )}
                    >
                      <span
                        className={cn(
                          "relative z-10 grid size-16 shrink-0 place-items-center rounded-full border-2 border-border bg-background font-mono text-sm font-semibold shadow-soft transition-all duration-500 sm:size-[4.5rem] sm:text-base",
                          "group-hover:border-accent group-hover:bg-accent group-hover:text-accent-foreground group-hover:shadow-lift group-hover:scale-105",
                          "group-focus-visible:border-accent group-focus-visible:bg-accent group-focus-visible:text-accent-foreground",
                        )}
                      >
                        {g.n}
                      </span>
                      <div>
                        <h3
                          className={cn(
                            "flex items-center gap-2 font-display text-xl tracking-tight sm:text-2xl",
                            right && "sm:flex-row-reverse",
                          )}
                        >
                          <g.icon className="size-4 text-accent opacity-60 transition-opacity group-hover:opacity-100" />
                          {g.title}
                        </h3>
                        <p className="mt-0.5 font-mono text-[0.55rem] uppercase tracking-[0.16em] text-muted-foreground">
                          {g.access}
                        </p>
                      </div>
                    </div>

                    <div
                      className={cn(
                        "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-500 ease-out-expo",
                        "group-hover:grid-rows-[1fr] group-hover:opacity-100",
                        "group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100",
                      )}
                    >
                      <div className="overflow-hidden">
                        <div
                          className={cn(
                            "mt-3 border-t border-border/70 pt-3",
                            right && "sm:text-right",
                          )}
                        >
                          <p className="rule-label mb-2 text-accent-ink">Services</p>
                          <ul
                            className={cn(
                              "flex flex-col gap-1",
                              right && "sm:items-end",
                            )}
                          >
                            {g.includes.map((svc) => (
                              <li
                                key={svc}
                                className="font-display text-lg leading-snug text-foreground sm:text-xl"
                              >
                                {svc}
                              </li>
                            ))}
                          </ul>
                          <p
                            className={cn(
                              "mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground",
                              right && "sm:ml-auto",
                            )}
                          >
                            {g.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ---------- Parcours d'accès ---------- */}
      <section id="parcours" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-5 pt-10 pb-20 sm:pt-12 sm:pb-28">
          <div className="max-w-2xl">
            <SectionLabel>Comment ça s&apos;ouvre</SectionLabel>
            <h2 className="mt-4 font-display text-3xl leading-tight sm:text-4xl">
              Trois niveaux.{" "}
              <span className="italic text-accent-ink">Une seule logique.</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              Comprendre d&apos;abord. Sauver ensuite. Agir quand vous êtes prêt.
            </p>
          </div>

          {/* Chemin animé */}
          <div className="relative mt-12 hidden h-1 md:block" aria-hidden>
            <div className="absolute inset-0 bg-border" />
            <div className="absolute inset-y-0 left-0 w-2/3 animate-[lm-sweep_2.8s_ease-in-out_infinite] bg-accent/80" />
          </div>

          <div className="mt-6 grid gap-0 md:grid-cols-3 md:divide-x md:divide-border md:border-y md:border-border">
            <article className="animate-rise flex flex-col py-8 md:px-8 md:py-10 md:first:pl-0">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-success-ink">
                01 · Visiteur
              </p>
              <h3 className="mt-3 font-display text-2xl">Sans rien créer</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                Accédez directement à l&apos;Assistant fiscal. Posez autant de questions que vous
                voulez — c&apos;est gratuit et sans compte.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {["Assistant fiscal ouvert", "Réponses sourcées BOFiP", "Aucun e-mail demandé"].map(
                  (t) => (
                    <li key={t} className="flex gap-2.5">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-success-ink" />
                      {t}
                    </li>
                  ),
                )}
              </ul>
              <Button asChild variant="outline" className="mt-8 w-full rounded-full sm:w-auto">
                <Link to="/education">Essayer maintenant</Link>
              </Button>
            </article>

            <article className="animate-rise flex flex-col border-t border-border py-8 md:border-t-0 md:px-8 md:py-10">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-info-ink">
                02 · Compte free
              </p>
              <h3 className="mt-3 font-display text-2xl">Connecté, freemium</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                Créez un compte gratuit : vos discussions sont sauvegardées, et vous explorez des
                démos des outils Premium pour voir ce qui vous attend.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {[
                  "Historique des conversations sauvé",
                  "Démos des écrans Premium",
                  "Reprise là où vous vous êtes arrêté",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-info-ink" />
                    {t}
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="mt-8 w-full rounded-full sm:w-auto">
                <Link to="/auth">Créer un compte free</Link>
              </Button>
            </article>

            <article className="animate-rise relative flex flex-col overflow-hidden border-t border-border bg-ink px-6 py-8 text-ink-foreground md:border-t-0 md:px-8 md:py-10">
              <div
                className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-40 blur-3xl"
                style={{ background: "var(--gradient-safran)" }}
                aria-hidden
              />
              <p className="relative font-mono text-[0.6rem] uppercase tracking-[0.18em] text-accent">
                03 · Premium
              </p>
              <h3 className="relative mt-3 font-display text-2xl">Tout le cockpit</h3>
              <p className="relative mt-3 flex-1 text-sm leading-relaxed text-ink-foreground/70">
                Mise en route, Ma situation, Justificatifs, Facturation, Expert-comptable,
                Transactions, Scénarios — les outils pour passer de comprendre à agir.
              </p>
              <ul className="relative mt-6 space-y-2.5 text-sm text-ink-foreground/85">
                {[
                  "Mise en route + profil fiscal",
                  "Justificatifs & Facturation",
                  "Expert-comptable + Scénarios",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                    {t}
                  </li>
                ))}
              </ul>
              <Button asChild variant="accent" className="relative mt-8 w-full rounded-full sm:w-auto">
                <Link to="/premium">Découvrir Premium</Link>
              </Button>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- Sources officielles (celles que l'app cite vraiment) ---------- */}
      <section className="overflow-hidden border-y border-border">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-16">
          <SectionLabel>Sources</SectionLabel>
          <h2 className="mt-3 max-w-2xl font-display text-2xl sm:text-3xl">
            Pas d&apos;invention —{" "}
            <span className="italic text-accent-ink">des textes officiels.</span>
          </h2>
        </div>
        <div className="border-t border-border bg-secondary/50 py-7" aria-hidden>
          <div className="animate-marquee flex w-max items-center gap-14 whitespace-nowrap sm:gap-20">
            {Array.from({ length: 2 }).flatMap((_, loop) =>
              OFFICIAL_SOURCES.map((src, i) => (
                <img
                  key={`${loop}-${i}`}
                  src={src.logo}
                  alt={src.name}
                  className="h-9 w-auto max-w-[9rem] shrink-0 object-contain sm:h-11 sm:max-w-[11rem]"
                />
              )),
            )}
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-5 py-10">
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            L&apos;Assistant fiscal s&apos;appuie sur la doctrine et les sites publics français.
            Chaque réponse peut citer sa source — et signaler un texte périmé.
          </p>
        </div>
      </section>

      {/* ---------- CTA final ---------- */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{ background: "var(--gradient-ink)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-20 top-0 h-full w-1/2 opacity-30 blur-3xl"
          style={{ background: "var(--gradient-safran)" }}
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-5 py-20 text-ink-foreground sm:flex-row sm:items-center sm:justify-between sm:py-24">
          <div>
            <p className="font-display text-safran text-sm">LedgerMind</p>
            <h2 className="mt-2 max-w-lg font-display text-3xl leading-tight sm:text-4xl">
              Commencez par une question —{" "}
              <span className="italic">pas par un parcours.</span>
            </h2>
            <p className="mt-3 max-w-md text-sm text-ink-foreground/70">
              La démo ci-dessus tourne déjà. Votre vraie question, c&apos;est la suite.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" variant="accent" className="rounded-full px-7">
              <Link to="/education">
                Ouvrir l&apos;Assistant fiscal <ArrowRight />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-ink-foreground/35 bg-transparent px-7 text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground"
            >
              <Link to="/auth">Créer un compte</Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
