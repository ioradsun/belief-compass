import { describe, expect, it } from "vitest";
import { wagmiConfig, isMobileWeb, walletProvider } from "./wagmi";
import { base } from "wagmi/chains";

/**
 * RainbowKit is the primary connect experience; Privy is the secondary,
 * lazy-loaded fallback. Connectors are constructed in the browser only, so
 * outside a browser the config must ship with none (they'd otherwise drag the
 * wallet SDK graph into the SSR/worker bundle).
 */
describe("wagmi config", () => {
  it("declares no connectors outside the browser", () => {
    expect((wagmiConfig.connectors as readonly unknown[]).length).toBe(0);
  });

  it("targets Base", () => {
    expect(wagmiConfig.chains.map((c) => c.id)).toEqual([base.id]);
  });

  it("defaults to RainbowKit as the connect provider", () => {
    expect(walletProvider()).toBe("rainbowkit");
  });

  it("mobile detection never throws outside a browser", () => {
    expect(() => isMobileWeb()).not.toThrow();
  });
});
