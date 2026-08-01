import { cn } from "@/lib/utils";

/** Sceau LedgerMind : carré d'encre, « L » safran, arc clair qui referme le M. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect x="1" y="1" width="30" height="30" rx="9" className="fill-primary" />
      <path
        d="M9 8v16h9"
        className="stroke-accent"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M14.5 8c4.5 0 8 3.1 8 7s-3.5 7-8 7"
        className="stroke-[var(--primary-foreground)]"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.65"
      />
    </svg>
  );
}

export function Wordmark({
  className,
  onInk = false,
  markClassName,
}: {
  className?: string;
  onInk?: boolean;
  markClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Mark className={markClassName} />
      <span
        className={cn(
          "font-display text-base font-semibold tracking-tight",
          onInk ? "text-ink-foreground" : "text-foreground",
        )}
      >
        Ledger<span className="text-accent">Mind</span>
      </span>
    </span>
  );
}
