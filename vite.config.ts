// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Fresh id per build — inlined into the client bundle AND read by the server
// build-id endpoint, so VersionWatcher can detect and hard-reload stale tabs.
const BUILD_ID = String(Date.now());

/**
 * Wallet connector SDKs (Coinbase / WalletConnect / Reown / porto) are browser-only,
 * but they were being pulled into the server bundle through `wagmi/connectors`.
 * The worker bundler mis-splits that vendor graph — a chunk references an
 * initializer (`init_call` / `init_custom`) declared in a sibling chunk and never
 * imported — so every SSR request crashed with `ReferenceError: … is not defined`
 * and returned 500. Stubbing the module outside the client build keeps that graph
 * off the server entirely; connectors are only ever constructed in the browser.
 */
const STUB_ID = "\0wagmi-connectors-server-stub";
const stubWalletConnectorsOnServer = {
  name: "stub-wagmi-connectors-on-server",
  enforce: "pre" as const,
  resolveId(this: { environment?: { name?: string } }, id: string) {
    const isConnectors = id === "wagmi/connectors" || id === "@wagmi/connectors";
    if (isConnectors && this.environment?.name !== "client") return STUB_ID;
    return null;
  },
  load(id: string) {
    if (id !== STUB_ID) return null;
    // Rolldown resolves named imports statically, so the stub must declare every
    // name any consumer imports — real package exports plus wallet names that
    // RainbowKit reaches for even when the installed version lacks them.
    const real = (() => {
      try {
        const src = readFileSync(
          fileURLToPath(new URL("./node_modules/@wagmi/connectors/dist/esm/exports/index.js", import.meta.url)),
          "utf8",
        );
        return [...src.matchAll(/export\s*{([^}]*)}/g)].flatMap((m) =>
          m[1].split(",").map((s: string) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
        );
      } catch {
        return [];
      }
    })();
    const names = [...new Set([...real, "injected", "mock", "coinbaseWallet", "baseAccount", "walletConnect", "metaMask", "safe", "porto", "gemini", "tempoWallet", "version"])];
    return `const clientOnly = () => { throw new Error("wallet connectors are client-only"); };
${names.map((n) => `export const ${n} = clientOnly;`).join("\n")}
export default {};`;
  },


};

/**
 * Vite maps the bare `events` builtin to an EMPTY browser-external stub in the
 * client build, so WalletConnect's `import EE, { EventEmitter } from "events"`
 * yields `undefined` and mobile Safari dies with
 * `undefined is not a constructor (evaluating 'new te.EventEmitter')`.
 * Point `events` at our shim (backed by the real `events` package) instead.
 */
const EVENTS_SHIM = fileURLToPath(new URL("./src/lib/shims/events.ts", import.meta.url));
// Vite maps anything starting with `events` to the empty builtin stub in the
// browser, including the deep path, so resolve the real file ourselves.
const EVENTS_IMPL = fileURLToPath(new URL("./node_modules/events/events.js", import.meta.url));
const eventsShimInBrowser = {
  name: "events-shim-in-browser",
  enforce: "pre" as const,
  resolveId(this: { environment?: { name?: string } }, id: string) {
    if (this.environment?.name !== "client") return null;
    if (id === "events" || id === "node:events") return EVENTS_SHIM;
    if (id === "events/events.js" || id === "node:events/events.js") return EVENTS_IMPL;
    return null;
  },
};

/**
 * RainbowKit's wallet factories (and the `wagmi/connectors` graph behind them)
 * are browser-only. Outside the client build, resolve the connector module to a
 * stub so the worker/SSR bundle never sees that vendor graph.
 */
const CONNECTORS_STUB = "\0wallet-connectors-server-stub";
const stubWalletConnectorsModule = {
  name: "stub-wallet-connectors-module",
  enforce: "pre" as const,
  resolveId(this: { environment?: { name?: string } }, id: string) {
    if (this.environment?.name === "client") return null;
    return id === "@/lib/wallet-connectors" || id.endsWith("src/lib/wallet-connectors.ts")
      ? CONNECTORS_STUB
      : null;
  },
  load(id: string) {
    if (id !== CONNECTORS_STUB) return null;
    return `export const WALLETCONNECT_PROJECT_ID = "";
export function browserConnectors() { return []; }`;
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Node compat MUST stay on. Turning it off dropped both the `nodejs_compat`
  // worker flag and unenv's Node polyfills, which removes AsyncLocalStorage —
  // TanStack Start stores its request context there, so every server function in
  // production failed with "No Start context found in AsyncLocalStorage" (500)
  // and the feed sat on the loading skeleton forever.
  nitro: { cloudflare: { nodeCompat: true, deployConfig: true } },
  vite: {
    define: {
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
    },
    optimizeDeps: {
      // WHY THIS LIST IS EXHAUSTIVE — it is the fix for "the preview stalls,
      // reverts, and reloads forever".
      //
      // Vite pre-bundles deps on demand. Anything NOT listed here is discovered
      // mid-load, and the moment it is, Vite logs "✨ optimized dependencies
      // changed. reloading" and pushes a full page reload over the HMR socket.
      // In the preview iframe that socket frequently cannot connect at all
      // (cross-origin proxy), so one of two things happens — both look like a
      // stall:
      //   • the reload lands → the boot we were two seconds into is thrown away
      //     and starts over, on every cold start;
      //   • the reload never lands → the tab keeps requesting the OLD dep URLs,
      //     gets 504 "Outdated Optimize Dep", dynamic imports reject, and the
      //     page sits on the skeleton.
      //
      // The wallet SDKs are the worst offenders precisely because they are
      // lazy: they are discovered the first time someone taps Connect, so the
      // re-optimization is triggered by a user action mid-session. Listing them
      // pre-bundles them once at server start instead.
      //
      // Keep in sync with node_modules/.vite/deps/_metadata.json, and only list
      // packages that are actually installed — a missing entry causes the very
      // re-optimization this list exists to prevent.
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "@tanstack/react-router > @tanstack/react-store",
        "seroval",
        "@supabase/supabase-js",
        "lucide-react",
        "zod",
        "viem",
        "viem/chains",
        "wagmi",
        "wagmi/actions",
        "wagmi/chains",
        "@rainbow-me/rainbowkit",
        "@rainbow-me/rainbowkit/wallets",
        "eventemitter3",
        "@coinbase/wallet-sdk",
        "@walletconnect/time",
        "@walletconnect/environment",
        "@walletconnect/window-metadata",
        "@walletconnect/window-getters",
        "@walletconnect/jsonrpc-utils",
        "blakejs",
        "pino",
      ],
    },

    plugins: [eventsShimInBrowser, stubWalletConnectorsOnServer, stubWalletConnectorsModule],
  },
});




