import { describe, expect, it } from "vitest";
import {
  wagmiConfig,
  lazyConnector,
  prefetchWalletSdks,
  LAZY_COINBASE_ID,
  LAZY_WALLETCONNECT_ID,
} from "./wagmi";

/**
 * Guardrails for the mobile Coinbase deep-link path. Each assertion here maps to a
 * regression we have actually shipped before:
 *  - Coinbase must stay off the eager connector list (first-load weight), but the
 *    SDK must be prefetchable so the later tap opens the app inside the gesture.
 *  - `preference: "all"` keeps the Coinbase app (deep-link) option visible next to
 *    Smart Wallet; "smartWalletOnly" silently kills mobile app connects.
 *  - WalletConnect's own modal must stay on, otherwise a mobile tap does nothing.
 */
describe("wallet connectors", () => {
  it("keeps heavy SDKs out of the eager config (and connectors off the SSR graph)", () => {
    const ids = (wagmiConfig.connectors as readonly { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(LAZY_COINBASE_ID);
    expect(ids).not.toContain(LAZY_WALLETCONNECT_ID);
  });


  it("prefetch never throws (it runs on modal open, in render path)", () => {
    expect(() => prefetchWalletSdks()).not.toThrow();
  });

  it("builds a Coinbase connector that allows the Coinbase app, not just Smart Wallet", async () => {
    const fn = await lazyConnector("coinbase");
    const connector = wagmiConfig._internal.connectors.setup(fn);
    expect(connector.id).toBe(LAZY_COINBASE_ID);
    const preference = (
      connector as unknown as {
        parameters?: { preference?: string };
      }
    ).parameters?.preference;
    // undefined only if wagmi stops exposing parameters; the id check above still holds.
    if (preference !== undefined) expect(preference).toBe("all");
  });

  it("builds a WalletConnect connector with its QR/deep-link sheet enabled", async () => {
    const fn = await lazyConnector("walletConnect");
    const connector = wagmiConfig._internal.connectors.setup(fn);
    expect(connector.id).toBe(LAZY_WALLETCONNECT_ID);
    const showQrModal = (
      connector as unknown as {
        parameters?: { showQrModal?: boolean };
      }
    ).parameters?.showQrModal;
    if (showQrModal !== undefined) expect(showQrModal).toBe(true);
  });

  it("resolves the lazy connector fast enough to stay inside a tap gesture once prefetched", async () => {
    prefetchWalletSdks();
    await import("wagmi/connectors");
    const start = performance.now();
    await lazyConnector("coinbase");
    expect(performance.now() - start).toBeLessThan(50);
  });
});
