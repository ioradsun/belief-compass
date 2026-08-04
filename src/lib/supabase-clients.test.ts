import { describe, it, expect, afterEach } from "vitest";
import { serviceClientOrNull } from "./supabase-clients";

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
