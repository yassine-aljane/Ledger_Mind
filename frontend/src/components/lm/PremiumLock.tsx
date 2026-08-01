import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/plan";

export type PremiumBullet = { icon: LucideIcon; label: string; hint: string };

type Props = {
  title: string;
  eyebrow?: string;
  pitch: string;
  bullets: PremiumBullet[];
  preview: ReactNode;
  children: ReactNode;
};

export function PremiumLock({ title, eyebrow, pitch, bullets, preview, children }: Props) {
  const plan = usePlan();
  if (plan === "premium") return <>{children}</>;

  return (
    <div className="animate-fade-in relative">
      {/* Aperçu flouté, non interactif : on montre la forme de l'écran, jamais de fausse donnée
          lisible. */}
      <div
        aria-hidden
        className="pointer-events-none max-h-[520px] select-none overflow-hidden opacity-40 blur-[6px]"
      >
        {preview}
      </div>

      {/* Voile de fondu */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-full bg-linear-to-b from-background/60 via-background/95 to-background"
      />

      <div className="animate-rise relative -mt-[420px] mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
          <div aria-hidden className="surface-grain absolute inset-0" />
          <div
            aria-hidden
            className="shimmer-premium pointer-events-none absolute inset-0"
          />
          <div
            aria-hidden
            className="absolute -right-24 -top-24 size-64 rounded-full bg-accent/20 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -left-24 size-64 rounded-full bg-success/15 blur-3xl"
          />

          <div className="relative p-8 md:p-12">
            <div className="mb-7 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/12 px-3 py-1 font-mono text-[0.55rem] font-medium uppercase tracking-[0.16em] text-accent-ink">
                <Lock className="size-3" /> Premium
              </span>
              {eyebrow && <span className="rule-label text-muted-foreground">{eyebrow}</span>}
            </div>

            <h2 className="mb-5 text-balance text-3xl md:text-4xl">
              {title} <span className="font-normal italic text-muted-foreground">verrouillé.</span>
            </h2>
            <p className="mb-9 max-w-xl text-pretty text-base text-muted-foreground">{pitch}</p>

            <ul className="mb-9 grid gap-4 sm:grid-cols-3">
              {bullets.map((b) => (
                <li
                  key={b.label}
                  className="card-hover rounded-2xl border border-border bg-secondary/40 p-4"
                >
                  <span className="mb-3 inline-flex size-8 items-center justify-center rounded-lg bg-primary/8 text-primary">
                    <b.icon className="size-4" />
                  </span>
                  <p className="mb-1 text-sm font-medium">{b.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{b.hint}</p>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg" variant="accent" className="rounded-full">
                <Link to="/premium">
                  Débloquer Premium <ArrowRight />
                </Link>
              </Button>
              <Link
                to="/education"
                className="text-sm font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-foreground"
              >
                Rester en gratuit (Éducation)
              </Link>
              <span className="rule-label ml-auto text-muted-foreground">
                14 jours d&apos;essai
              </span>
            </div>
          </div>

          {/* Bord perforé, en écho au reçu fiscal */}
          <div className="perforated-bottom h-3" />
        </div>
      </div>
    </div>
  );
}
