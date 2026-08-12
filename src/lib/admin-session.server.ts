/**
 * The admin session — one shared password gate, server-only.
 *
 * Lives in a `.server.ts` module because `useSession` is a server import: any
 * file that holds it at module scope drags it into the client graph. Server
 * functions load this inside their handlers.
 */
import { useSession } from "@tanstack/react-start/server";

export type AdminSession = { unlocked?: boolean };

function sessionConfig() {
  return {
    password: process.env.ADMIN_SESSION_SECRET!,
    name: "conviction-admin",
    maxAge: 60 * 60 * 8,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

export async function adminSession() {
  // Not a React hook: `useSession` is TanStack's server-side session reader. The
  // rules-of-hooks lint only sees the `use` prefix.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return await useSession<AdminSession>(sessionConfig());
}

async function digest(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(buf);
}

export async function passwordMatches(input: string, expected: string) {
  const [a, b] = await Promise.all([digest(input), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function requireAdmin() {
  const session = await adminSession();
  if (!session.data.unlocked) throw new Error("Locked.");
  return session;
}
