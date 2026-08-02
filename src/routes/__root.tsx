import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useLayoutEffect, type ReactNode } from "react";

// useLayoutEffect warns when run during SSR; fall back to useEffect on the server
// (both are no-ops there). On the client this runs before paint.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { WalletProviders } from "../components/WalletConnect";
import { DisplayUnitProvider } from "../lib/display-unit";
import { VersionWatcher } from "../components/VersionWatcher";
import { restoreQueryCache, startQueryPersist } from "../lib/query-persist";
import { startRealtime } from "../lib/realtime/coordinator";

// Web fonts, loaded OFF the critical path. The system fallback stack in styles.css
// (system-ui / -apple-system / Segoe UI …) paints instantly; Inter + JetBrains
// Mono swap in when their CSS arrives, so a cross-origin stylesheet never blocks
// first paint. `display=swap` keeps the font files non-blocking too.
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
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
      // Cache-busting: prevent the HTML shell from being cached so a new deploy's
      // hashed JS/CSS references are picked up on the next navigation.
      { httpEquiv: "Cache-Control", content: "no-cache, no-store, must-revalidate" },
      { httpEquiv: "Pragma", content: "no-cache" },
      { httpEquiv: "Expires", content: "0" },
      { title: "Conviction — see who actually believes" },
      {
        name: "description",
        content:
          "Prediction markets ranked by real believer conviction — money weight vs people weight, side by side.",
      },
      { property: "og:title", content: "Conviction — see who actually believes" },
      {
        property: "og:description",
        content: "Prediction markets ranked by real believer conviction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "google-site-verification",
        content: "bwpgUKb-7YZYYBznOf1on_p1g7RrNKJsw7pkJJFvhd4",
      },
    ],
    links: [
      // App CSS is same-origin, hashed + immutably cached — the only stylesheet on
      // the critical path. Fonts are preconnected + preloaded but applied off-path
      // (see RootShell), so first paint never waits on fonts.googleapis.com.
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "preload", as: "style", href: FONT_HREF },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Apply the web fonts without blocking first paint: attach the stylesheet
            as media="print" (ignored for screen), then flip to "all" on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=document.createElement('link');l.rel='stylesheet';l.media='print';l.href=${JSON.stringify(
              FONT_HREF,
            )};l.onload=function(){l.media='all'};document.head.appendChild(l);}catch(e){}})();`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={FONT_HREF} />
        </noscript>
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

  // Instant-on-return: re-hydrate last session's cache before the browser paints,
  // so client panels show their last-seen data instead of flashing a skeleton
  // first. A LAYOUT effect runs after hydration completes (so the first client
  // render still matches the SSR HTML — no mismatch) but BEFORE paint, so the
  // restore-driven re-render is flushed without a visible empty→data blink. The
  // isomorphic wrapper keeps React from warning about useLayoutEffect on the
  // server, where restoreQueryCache is a no-op anyway.
  useIsomorphicLayoutEffect(() => {
    restoreQueryCache(queryClient);
  }, [queryClient]);

  // Persistence + the realtime socket come alive after paint (never blocking it).
  useEffect(() => {
    const stopPersist = startQueryPersist(queryClient);
    const stopRealtime = startRealtime(queryClient);
    return () => {
      stopRealtime();
      stopPersist();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProviders>
        <DisplayUnitProvider>
          <VersionWatcher />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </DisplayUnitProvider>
      </WalletProviders>
    </QueryClientProvider>
  );
}
