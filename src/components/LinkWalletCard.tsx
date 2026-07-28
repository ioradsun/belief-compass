import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useNavigate } from "@tanstack/react-router";
import { linkMessage, writeLocalLink, readLocalLink, clearLocalLink } from "@/lib/wallet-link";
import { linkWallet } from "@/lib/wallet-link.functions";

/**
 * Links the connected login wallet (often a smart wallet with no trades) to the
 * POV trading wallet. Two paths: remember it in this browser, or prove
 * ownership by signing with the trading wallet so the link works everywhere.
 */
export function LinkWalletCard() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const connected = address?.toLowerCase() ?? null;
  const existing = connected ? readLocalLink(connected) : null;
  const target = value.trim().toLowerCase();
  const valid = /^0x[a-f0-9]{40}$/.test(target);

  function go(addr: string) {
    // The wallet view is the home "You" panel — focus the feed on this wallet.
    void navigate({ to: "/", search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({ ...prev, wallet: addr }) });
  }

  function remember() {
    if (!valid || !connected) return;
    writeLocalLink(connected, target);
    setMsg("Saved in this browser.");
    go(target);
  }

  // The signature has to come from the trading wallet itself. wagmi can only
  // sign with the account that is currently connected, so we park the login
  // address, ask the user to switch, then sign once the accounts line up.
  const PENDING = "conviction:pending-link";
  const pendingOrigin =
    typeof window !== "undefined" ? window.sessionStorage.getItem(PENDING) : null;
  const originLogin = pendingOrigin && pendingOrigin !== connected ? pendingOrigin : null;
  const switched = Boolean(originLogin && connected === target);

  async function verify() {
    if (!valid || !connected) return;
    setErr(null);
    setMsg(null);

    if (connected !== target) {
      // Still on the login wallet — remember it and hand off to the wallet app.
      window.sessionStorage.setItem(PENDING, connected);
      setMsg(
        "Now switch your wallet to the trading address and press “Verify by signing” again.",
      );
      return;
    }

    const origin = originLogin;
    if (!origin) {
      setErr(
        "Start from your login wallet: connect it, enter the trading address, then switch and sign.",
      );
      return;
    }

    setBusy(true);
    try {
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const signature = await signMessageAsync({
        message: linkMessage(origin, target, nonce),
      });
      await linkWallet({ data: { connected: origin, linked: target, nonce, signature } });
      writeLocalLink(origin, target);
      window.sessionStorage.removeItem(PENDING);
      setMsg("Verified — this link now follows you across devices.");
      go(target);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "Could not verify. Connect the trading wallet in your wallet app, then sign.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-dashed border-border p-6">
      <div className="text-sm font-medium">Link your pov.co trading wallet</div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Smart wallets (Coinbase Smart Wallet, passkey accounts) sign in with a different address
        than the one you trade with on pov.co, and there's no on-chain link between them. Tell us
        the trading wallet once — or sign with it to make the link permanent.
      </p>

      {existing && (
        <div className="mt-3 flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Remembered:</span>
          <button className="font-mono hover:underline" onClick={() => go(existing)}>
            {existing.slice(0, 6)}…{existing.slice(-4)}
          </button>
          <button
            className="text-muted-foreground hover:underline"
            onClick={() => {
              if (connected) clearLocalLink(connected);
              setMsg("Cleared.");
            }}
          >
            clear
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x… trading wallet"
          className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={remember}
          disabled={!valid || !isConnected}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Remember here
        </button>
        <button
          type="button"
          onClick={() => void verify()}
          disabled={!valid || !isConnected || busy}
          className="rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Waiting for signature…" : "Verify by signing"}
        </button>
        <button
          type="button"
          onClick={() => valid && go(target)}
          disabled={!valid}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Just view
        </button>
      </div>

      {!isConnected && (
        <p className="mt-2 text-xs text-muted-foreground">Connect a wallet to save a link.</p>
      )}
      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        To verify, switch your wallet to the trading account first — the signature must come from
        that address.
      </p>
      {msg && <p className="mt-2 text-xs text-emerald-600">{msg}</p>}
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}
