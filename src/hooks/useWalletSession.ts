/**
 * useWalletSession — one signature per wallet, cached locally, reused by every
 * write that is keyed by a wallet address (beliefs, House rounds).
 */
import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  randomNonce,
  readSessionToken,
  sessionMessage,
  writeSessionToken,
} from "@/lib/wallet-session";
import { startWalletSession } from "@/lib/wallet-session.functions";

export function useWalletSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const ensureSession = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("Connect a wallet first.");
    const cached = readSessionToken(address);
    if (cached) return cached;
    const nonce = randomNonce();
    const signature = await signMessageAsync({
      message: sessionMessage(address, nonce),
      account: address,
    });
    const res = await startWalletSession({ data: { wallet: address, nonce, signature } });
    writeSessionToken(address, res.token, res.exp);
    return res.token;
  }, [address, signMessageAsync]);

  return { ensureSession, address };
}
