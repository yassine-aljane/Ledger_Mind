import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Chasse mono + capitales espacées, dans la même famille visuelle que `rule-label-lg` —
// dont ce composant reprend désormais la taille (12 px) et l'interlettrage (0,08em).
// Il était à 0,65rem, soit 10,4 px : sous le plancher de lisibilité, alors que c'est lui qui
// porte les statuts qui décident d'une action — « brouillon », « plafond dépassé », la
// sévérité d'une alerte. Une étiquette d'état ne se devine pas, elle se lit.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs font-medium uppercase tracking-[0.08em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        success: "border-success/30 bg-success/12 text-success-ink",
        warning: "border-warning/40 bg-warning/15 text-warning-ink",
        info: "border-info/30 bg-info/12 text-info-ink",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
