/**
 * Anonymous per-browser id — the thread that lets an attributed link OPEN be
 * connected to a wallet later, with no account and nothing personal stored. It
 * is a random token in localStorage, nothing more.
 */
const KEY = "conviction.visitor";

export function getVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = randomId();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function randomId(): string {
  try {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}
