import { describe, expect, it } from "vitest";
import { wagmiConfig, isMobileWeb } from "./wagmi";
import { base } from "wagmi/chains";

/**
 * Wallet connectivity is delegated to Privy: it owns the modal, mobile
 * deep-links and session restore, and injects connectors into wagmi at runtime.
 * The config must therefore ship with no eager connectors of its own (they'd
 * both duplicate Privy's list and drag wallet SDKs into the SSR/first-load graph).
 */
describe("wagmi config", () => {
  it("declares no eager connectors — Privy injects them", () => {
    expect((wagmiConfig.connectors as readonly unknown[]).length).toBe(0);
  });

  it("targets Base", () => {
    expect(wagmiConfig.chains.map((c) => c.id)).toEqual([base.id]);
  });

  it("mobile detection never throws outside a browser", () => {
    expect(() => isMobileWeb()).not.toThrow();
  });
});
