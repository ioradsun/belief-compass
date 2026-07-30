/**
 * Privy ships optional Solana funding paths. This app is Ethereum-only (Base),
 * so `@solana-program/system` is never installed — Vite then substitutes an
 * empty optional-peer-dep stub and the build fails with
 * `"getTransferSolInstruction" is not exported`. This shim satisfies the import
 * without pulling the whole Solana SDK graph into the bundle.
 */
export function getTransferSolInstruction(): never {
  throw new Error("Solana transfers are not supported in this app.");
}

export default {};
