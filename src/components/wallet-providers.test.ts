import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/components/WalletConnect.tsx"), "utf8");

/**
 * A SOURCE-LEVEL GUARD, because the bug it prevents has no cheaper detector.
 *
 * `WalletProviders` wraps the entire application. Putting a `key` on the
 * `WagmiProvider` inside it — which is exactly what someone reaches for when
 * they notice wagmi only reconnects on mount — unmounts and remounts the WHOLE
 * TREE about 200ms after first paint, on every cold load, for every visitor.
 *
 * Nothing crashes. Types pass. Tests pass. The symptoms are diffuse: component
 * state resets, effects re-run, query observers re-subscribe, mount guards
 * flash. It is the kind of regression that gets re-introduced by a reasonable
 * person solving a real problem, so the invariant is written down where a test
 * run will find it.
 *
 * The correct fix is already in the file: swap the config and call
 * `useReconnect()`, which is what the remount was imitating.
 */
describe("the app is never remounted to make wagmi reconnect", () => {
  it("puts no key on the provider that wraps the application", () => {
    const provider = SOURCE.slice(
      SOURCE.indexOf("<WagmiProvider"),
      SOURCE.indexOf("</WagmiProvider>"),
    );
    expect(provider).not.toMatch(/\bkey=/);
  });

  it("restores the session through wagmi's own action instead", () => {
    expect(SOURCE).toMatch(/useReconnect/);
  });

  /**
   * The other half of the same invariant: the connector-free boot config is
   * what keeps wallet SDKs off the first-paint path. A config built with real
   * connectors at module scope would put them back on it.
   */
  it("still boots from the connector-free config", () => {
    expect(SOURCE).toMatch(/useState<Config>\(wagmiConfig\)/);
  });
});
