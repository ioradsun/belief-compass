// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
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
    return `const clientOnly = () => { throw new Error("wallet connectors are client-only"); };
export const injected = clientOnly;
export const coinbaseWallet = clientOnly;
export const walletConnect = clientOnly;
export default {};`;
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        // Bare `events` -> our shim, which guarantees a named `EventEmitter`
        // export in the browser bundle (WalletConnect needs it).
        { find: /^events$/, replacement: fileURLToPath(new URL("./src/lib/shims/events.ts", import.meta.url)) },
      ],
    },
    define: {
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
    },
    plugins: [stubWalletConnectorsOnServer],
  },
});



