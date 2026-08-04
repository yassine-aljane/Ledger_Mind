import { Link } from "@tanstack/react-router";
import { Check, Lock, type LucideIcon } from "lucide-react";
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

/**
 * Paywall d'un écran Premium.
 *
 * L'aperçu occupe la colonne principale et reste LISIBLE : juger un outil suppose de voir ce
 * qu'il produit. Il s'estompe simplement vers le bas (masque dégradé) pour signaler que l'écran
 * continue — c'est une invitation, pas une censure.
 *
 * Contrepartie non négociable : l'étiquette « Exemple de démonstration » est posée sur l'aperçu
 * lui-même, et le bloc est inerte. Ces chiffres ne sont pas ceux de l'utilisateur.
 */
export function PremiumLock({ title, eyebrow, pitch, bullets, preview, children }: Props) {
  const plan = usePlan();
  if (plan === "premium") return <>{children}</>;

  return (
    <div className="animate-fade-in grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-w-0">
        <div
          className="pointer-events-none select-none [mask-image:linear-gradient(to_bottom,black_38%,transparent_96%)]"
          inert
        >
          {preview}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-background to-transparent"
        />
        <span className="rule-label absolute right-4 top-4 rounded-full bg-ink px-3 py-1 text-ink-foreground">
          Exemple de démonstration
        </span>
      </div>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <div className="animate-rise overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
          <div className="shimmer-premium surface-ink relative overflow-hidden px-6 py-7">
            <div aria-hidden className="surface-grain absolute inset-0 opacity-50" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-ink-foreground/25 px-3 py-1 text-xs font-medium text-ink-foreground">
                <Lock className="size-3.5" /> Inclus dans Premium
              </span>
              <h2 className="mt-4 text-balance text-2xl text-ink-foreground">{title}</h2>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-foreground/75">
                {pitch}
              </p>
            </div>
          </div>

          <div className="space-y-3 p-6">
            {bullets.map((b) => (
              <p key={b.label} className="flex gap-3 text-sm text-foreground" title={b.hint}>
                <Check className="mt-0.5 size-4 shrink-0 text-success-ink" />
                {b.label}
              </p>
            ))}

            <Button asChild variant="accent" className="mt-4 w-full">
              <Link to="/premium">Passer Premium</Link>
            </Button>
            {eyebrow && (
              <p className="rule-label pt-2 text-center text-muted-foreground">
                {eyebrow} · 14 jours d&apos;essai
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
