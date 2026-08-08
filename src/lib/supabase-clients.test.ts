import { describe, it, expect, afterEach, vi } from "vitest";
import { serviceClient, serviceClientOrNull, missingServiceSecrets } from "./supabase-clients";

const KEY = "SUPABASE_SERVICE_ROLE_KEY";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

/**
 * `createClient` throws "supabaseKey is required" synchronously on a missing
 * key. The live tape does exactly one privileged read — how long each actor had
 * held the belief they just changed — on a PUBLIC request path, so calling
 * `serviceClient()` there coupled the whole feed to a secret: a rotated or unset
 * key turned "the feed loses tenure" into "the feed 500s for everyone".
 */
describe("a missing service key costs detail, not the page", () => {
  it("returns null instead of throwing", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env[KEY];
    expect(() => serviceClientOrNull()).not.toThrow();
    expect(serviceClientOrNull()).toBeNull();
  });

  it("returns a client when the key is present", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env[KEY] = "service-role-test-key";
    expect(serviceClientOrNull()).not.toBeNull();
  });

  it("treats an empty string as absent — a blank secret is not a secret", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env[KEY] = "";
    expect(serviceClientOrNull()).toBeNull();
  });
});

/**
 * WHEN THE JOB CANNOT RUN, IT MUST SAY SO IN THE OPERATOR'S WORDS.
 *
 * `createClient` throws "supabaseKey is required": a message about a function
 * argument, naming no deployment variable and no product consequence. It reached
 * the logs as an anonymous 500 on a path whose visible symptom is an empty room,
 * which is how a missing secret can survive in production unnoticed.
 */
describe("a missing service key is named, loudly", () => {
  it("names the missing variable in the error", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env[KEY];
    expect(() => serviceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("logs as well as throws — a caller can swallow one, not both", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env[KEY];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      serviceClient();
    } catch {
      /* expected */
    }
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY"));
    spy.mockRestore();
  });

  it("never puts the secret's value in the message", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env[KEY] = "super-secret-value";
    // Present → no throw at all, so there is no message to leak into.
    expect(() => serviceClient()).not.toThrow();
    expect(missingServiceSecrets()).toEqual([]);
  });

  it("reports missing names, never values", () => {
    delete process.env.SUPABASE_URL;
    process.env[KEY] = "super-secret-value";
    expect(missingServiceSecrets()).toEqual(["SUPABASE_URL"]);
    expect(missingServiceSecrets().join()).not.toContain("super-secret-value");
  });
});
