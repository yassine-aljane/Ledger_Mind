import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { usePlan } from "@/lib/plan";

type Props = {
  title: string;
  eyebrow?: string;
  pitch: string;
  bullets: { icon: string; label: string; hint: string }[];
  preview: ReactNode;
  children: ReactNode;
};

export function PremiumLock({ title, eyebrow, pitch, bullets, preview, children }: Props) {
  const plan = usePlan();
  if (plan === "premium") return <>{children}</>;

  return (
    <div className="relative animate-fade-in">
      {/* Blurred, non-interactive preview */}
      <div
        aria-hidden
        className="pointer-events-none select-none blur-[6px] opacity-40 max-h-[520px] overflow-hidden"
      >
        {preview}
      </div>

      {/* Fading veil */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-background/60 via-background/95 to-background"
      />

      {/* Editorial lock card */}
      <div className="relative -mt-[420px] max-w-3xl mx-auto animate-slide-up">
        <div className="relative bg-white border border-border rounded-3xl overflow-hidden shadow-[0_40px_80px_-40px_rgba(22,36,31,0.25)]">
          {/* subtle grain */}
          <div className="absolute inset-0 grain-overlay" />
          {/* amber corner accent */}
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-amber-fiscal/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 size-64 rounded-full bg-teal-light/15 blur-3xl" />

          <div className="relative p-10 md:p-14">
            <div className="flex items-center gap-3 mb-8">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-fiscal/30 bg-amber-fiscal/10 text-amber-fiscal font-mono text-[10px] uppercase tracking-[0.25em]">
                <LockGlyph /> Premium
              </span>
              {eyebrow && (
                <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal-dark">
                  {eyebrow}
                </span>
              )}
            </div>

            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-balance mb-5">
              {title}{" "}
              <span className="italic font-normal text-ink/50">verrouillé.</span>
            </h2>
            <p className="text-lg text-ink/60 max-w-xl text-pretty mb-10">{pitch}</p>

            <ul className="grid sm:grid-cols-3 gap-4 mb-10">
              {bullets.map((b) => (
                <li
                  key={b.label}
                  className="border border-border rounded-2xl p-4 bg-background/50 card-hover"
                >
                  <div className="text-2xl mb-2">{b.icon}</div>
                  <p className="font-semibold text-sm mb-1">{b.label}</p>
                  <p className="text-xs text-ink/55 leading-relaxed">{b.hint}</p>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/premium"
                className="group inline-flex items-center gap-2 px-6 py-3 bg-ink text-background rounded-full text-sm font-semibold hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
              >
                Débloquer Premium
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                to="/education"
                className="text-sm font-medium text-ink/60 hover:text-ink transition-colors duration-200 underline underline-offset-4 decoration-dotted"
              >
                Rester en gratuit (Éducation)
              </Link>
              <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.25em] text-ink/40">
                14 jours d&apos;essai
              </span>
            </div>
          </div>

          {/* perforated bottom edge to echo the receipt */}
          <div className="h-3 perforated-bottom" />
        </div>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2" y="5.5" width="8" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
