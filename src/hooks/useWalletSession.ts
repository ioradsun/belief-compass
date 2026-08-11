/**
 * useWalletSession — a session per connected wallet, cached locally, reused by
 * every write that is keyed by a wallet address (beliefs, House rounds,
 * Simulation).
 *
 * NO SIGNATURE FOR FREE ACTIONS. Connecting the wallet is the proof; the
 * session is opened silently from the connected address. A wallet signature is
 * reserved for actions that involve real money — and real trades are signed by
 * the transaction itself, not by a separate prompt. `interactive` is kept only
 * so callers can express "don't open a session just for a read".
 */
import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  clearSessionToken,
  randomNonce,
  readSessionToken,
  sessionMessage,
  writeSessionToken,
} from "@/lib/wallet-session";
import { startConnectSession, startWalletSession } from "@/lib/wallet-session.functions";

export function useWalletSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  /** Signature-free: the connected wallet is the proof. */
  const mint = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("Connect a wallet first.");
    const res = await startConnectSession({ data: { wallet: address } });
    writeSessionToken(address, res.token, res.exp);
    return res.token;
  }, [address]);

  /** Signed session — only for flows that must prove ownership for money. */
  const mintSigned = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("Connect a wallet first.");
    const nonce = randomNonce();
    const signature = await signMessageAsync({
      message: sessionMessage(address, nonce),
      account: address,
    });
    const res = await startWalletSession({ data: { wallet: address, nonce, signature } });
    writeSessionToken(address, res.token, res.exp);
    return res.token;
  }, [address, signMessageAsync]);

  const ensureSession = useCallback(
    async (_opts?: { interactive?: boolean }): Promise<string> => {
      if (!address) throw new Error("Connect a wallet first.");
      return readSessionToken(address) ?? (await mint());
    },
    [address, mint],
  );

  /** Run a session-backed call, healing a stale token by opening a new one. */
  const withSession = useCallback(
    async <T>(run: (session: string) => Promise<T>, opts?: { interactive?: boolean }) => {
      const session = await ensureSession(opts);
      try {
        return await run(session);
      } catch (err) {
        if (!isStaleSession(err) || !address) throw err;
        clearSessionToken(address);
        return run(await mint());
      }
    },
    [address, ensureSession, mint],
  );



  return { ensureSession, withSession, address };
}

function isStaleSession(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /verify your wallet/i.test(msg);
}

/** Thrown when a free action would need a fresh signature — it is skipped instead. */
export class SignatureRequired extends Error {
  constructor() {
    super("Wallet signature required.");
    this.name = "SignatureRequired";
  }
}

/** Run a wallet-signed side effect only when a session already exists. */
export async function bestEffort<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SignatureRequired) return null;
    throw err;
  }
}
