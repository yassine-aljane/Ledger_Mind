import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="animate-rise max-w-md text-center">
        <p className="rule-label text-muted-foreground">Erreur 404</p>
        <h1 className="mt-4 text-4xl">
          Cette page <span className="font-normal italic">n'existe pas</span>
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Le lien que vous avez suivi est peut-être obsolète.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
          >
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="animate-rise max-w-md text-center">
        <p className="rule-label text-destructive">Incident</p>
        <h1 className="mt-3 text-3xl">Cette page n'a pas pu se charger</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Un incident est survenu. Vous pouvez réessayer.
        </p>
        {import.meta.env.DEV ? (
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-border bg-card p-3 text-left text-xs whitespace-pre-wrap text-destructive">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : null}
          </pre>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:border-ink"
          >
            Accueil
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LedgerMind — l'assistant fiscal qui parle humain" },
      {
        name: "description",
        content:
          "LedgerMind aide les freelances et créateurs à comprendre, calculer et provisionner leurs impôts, sans jargon.",
      },
      { name: "author", content: "LedgerMind" },
      { property: "og:title", content: "LedgerMind — l'assistant fiscal qui parle humain" },
      {
        property: "og:description",
        content:
          "L'assistant fiscal des freelances et créateurs français. Zéro jargon, tout expliqué.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=Manrope:wght@300..800&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Applique le thème mémorisé avant la première peinture (pas de flash clair en sombre). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative min-h-screen bg-background text-foreground">
        <div aria-hidden className="grain-overlay fixed inset-0 z-[100]" />
        <Outlet />
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </QueryClientProvider>
  );
}
