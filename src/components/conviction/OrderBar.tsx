import { useState } from "react";
import { useWallet } from "./WalletProvider";
import { useJoin } from "@/lib/join";
import type { Belief, SideKey } from "@/lib/contract";
import { cn } from "@/lib/utils";

const AMOUNTS = ["0.002", "0.005", "0.01", "0.05"];

/**
 * OrderBar — commitment. Connect is requested here and only here, inline:
 * pressing Confirm without a wallet opens connect and resumes the same order
 * in place. No navigation, ever.
 *
 * No projected value, expected return, or profit language appears in this flow.
 */
export function OrderBar({
  belief,
  side,
  onJoined,
}: {
  belief: Belief;
  side: SideKey;
  onJoined: () => void;
}) {
  const { address, connect } = useWallet();
  const { join, state, reset } = useJoin();
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const busy = state.status === "signing";

  async function confirm() {
    if (!address) {
      // Remember the intent, open connect in place, resume when the address lands.
      setPendingConfirm(true);
      connect();
      return;
    }
    setPendingConfirm(false);
    const hash = await join(belief.id, side, amount);
    if (hash) onJoined();
  }

  // Resume the held order once a wallet arrives — same room, same amount.
  if (pendingConfirm && address && !busy) {
    setPendingConfirm(false);
    void confirm();
  }

  if (state.status === "receipt" || state.status === "confirmed") {
    return (
      <div className="border-t border-border bg-panel px-4 py-4 wide:px-8">
        <p className="label-micro">
          {state.status === "confirmed" ? "On record" : "Recorded"}
        </p>
        <p className="mt-2 text-sm text-text">
          You stood on {side === "y" ? "YES" : "NO"} with{" "}
          <span className="font-num">{state.amountEth} ETH</span>.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-fine text-text-secondary underline underline-offset-2"
        >
          Back to the room
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-panel px-4 py-4 wide:px-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="label-micro">Stand on {side === "y" ? "Yes" : "No"}</span>
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(a)}
              className={cn(
                "rounded-full border px-2 py-0.5 font-num text-fine",
                a === amount
                  ? "border-border-strong bg-surface-raised text-text"
                  : "border-border text-text-secondary",
              )}
            >
              {a} ETH
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={cn(
            "shrink-0 rounded-sm border px-4 py-2 text-sm",
            side === "y"
              ? "border-yes/50 bg-yes-soft text-yes"
              : "border-no/50 bg-no-soft text-no",
            busy && "opacity-60",
          )}
        >
          {busy ? "Signing" : "Confirm"}
        </button>
      </div>
      {state.status === "error" ? (
        <p className="mt-2 text-fine text-text-secondary">{state.message}</p>
      ) : null}
      {!address ? (
        <p className="mt-2 text-fine text-text-secondary">
          Confirming asks for a wallet. Everything else here stays readable without one.
        </p>
      ) : null}
    </div>
  );
}
