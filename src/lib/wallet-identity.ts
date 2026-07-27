/**
 * Wallet identity helpers — deterministic aliases and generated-avatar seeds for
 * a raw address, plus the resolved-profile shape. Pure and stable: the same
 * wallet always maps to the same alias, initials, and hue. (Extracted from the
 * retired conviction-feed ranking module — these four are all that survived it.)
 */

export interface WalletProfile {
  displayName: string | null;
  pfpUrl: string | null;
}

const ADJECTIVES = [
  "Quiet",
  "Amber",
  "Orange",
  "Slate",
  "Cobalt",
  "Umber",
  "Jade",
  "Ivory",
  "Cedar",
  "Dusk",
  "Copper",
  "Indigo",
  "Hazel",
  "Ashen",
  "Basalt",
  "Marble",
  "Sable",
  "Verdant",
  "Onyx",
  "Pale",
  "Russet",
  "Teal",
  "Ochre",
  "Flint",
];
const NOUNS = [
  "Fox",
  "River",
  "Heron",
  "Falcon",
  "Otter",
  "Willow",
  "Marten",
  "Sparrow",
  "Bison",
  "Lynx",
  "Crane",
  "Badger",
  "Hawk",
  "Wren",
  "Ibis",
  "Stag",
  "Vole",
  "Finch",
  "Moth",
  "Elk",
  "Owl",
  "Kite",
  "Roe",
  "Pine",
];

/** FNV-1a over the lowercased hex. Stable forever for a given wallet. */
function hashWallet(wallet: string): number {
  let h = 0x811c9dc5;
  const s = wallet.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A neutral two-word alias for a wallet with no resolved POV identity. */
export function aliasFor(wallet: string): string {
  const h = hashWallet(wallet);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  return `${adj} ${noun}`;
}

/** Two initials for a generated avatar, from a real name or the neutral alias. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic hue (0..359) for a generated avatar, seeded by wallet. */
export function hueFor(wallet: string): number {
  return hashWallet(wallet) % 360;
}
