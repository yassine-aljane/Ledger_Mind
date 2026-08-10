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

/** Signature animée des en-têtes. Le cadre conserve sa largeur pour éviter tout décalage de la navigation. */
export function AnimatedWordmark({
  className,
  onInk = false,
  markClassName,
}: {
  className?: string;
  onInk?: boolean;
  markClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label="LedgerMind"
      className={cn(
        "lm-animated-wordmark inline-flex w-[8.4rem]",
        onInk && "lm-animated-wordmark--on-ink",
        className,
      )}
    >
      <span aria-hidden className="lm-auth-logo-intro">
        <span className="lm-auth-logo-word font-display text-lg font-semibold tracking-tight">
          {"LedgerMind".split("").map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className={cn(
                "lm-auth-logo-letter",
                index === 0 && "lm-auth-logo-letter--l",
                index > 0 && index < 9 && "lm-auth-logo-letter--middle",
                index === 9 && "lm-auth-logo-letter--d",
                index >= 6 && index < 9 && "text-accent",
              )}
            >
              {index === 9 ? (
                <>
                  <span className="lm-auth-logo-d-lower text-accent">d</span>
                  <span className="lm-auth-logo-d-upper">D</span>
                </>
              ) : (
                letter
              )}
            </span>
          ))}
        </span>
        <Mark className={cn("lm-auth-logo-final size-9", markClassName)} />
      </span>
    </span>
  );
}
