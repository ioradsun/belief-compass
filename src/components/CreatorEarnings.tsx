/**
 * CreatorEarnings — "you made these markets, here's what they paid you".
 *
 * Fees sit on the belief-market contract until the creator sweeps them, so this
 * reads the escrowed balance straight from chain and offers a single Claim.
 * The contract pays msg.sender, so the claim is only offered to the wallet that
 * is actually connected — if you're viewing under an imported POV wallet, we
 * say so instead of pretending.
 */
import { useAccount, useChainId } from "wagmi";
import { formatEther } from "viem";
import { CHAIN_ID } from "@/chain/decoder";
import { useFeeBalances, useClaimFees } from "@/lib/creator-fees";

const fmtEth = (wei: bigint) => {
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.00001) return "<0.00001";
  return n.toFixed(n < 0.01 ? 5 : 4);
};

export function CreatorEarnings({ ethUsd = 0 }: { ethUsd?: number }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onBase = chainId === CHAIN_ID;
  const { creator, referral, isLoading, refetch } = useFeeBalances(address);
  const { claim, pending, isMining, isSuccess, error, clear } = useClaimFees();

  if (!isConnected || !address) {
    return (
      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
        Connect the wallet you created your markets with to see and claim creator fees.
      </p>
    );
  }

  const usd = (wei: bigint) =>
    ethUsd > 0 ? `≈ $${(Number(formatEther(wei)) * ethUsd).toFixed(2)}` : null;

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
        Every trade on a market you created pays you a share of the fee. It's held on the contract
        until you claim it.
      </p>

      <Row
        label="Creator fees"
        wei={creator}
        loading={isLoading}
        usd={usd}
        busy={pending === "creator" || (isMining && pending === null)}
        disabled={!onBase}
        onClaim={() => claim("creator")}
      />
      <Row
        label="Referral fees"
        wei={referral}
        loading={isLoading}
        usd={usd}
        busy={pending === "referral"}
        disabled={!onBase}
        onClaim={() => claim("referral")}
      />

      {!onBase && <p className="text-[11px] text-[var(--text-muted)]">Switch to Base to claim.</p>}
      {isMining && <p className="text-[11px] text-[var(--text-muted)]">Claim confirming…</p>}
      {isSuccess && (
        <p className="text-[11px] text-[var(--text)]">
          Claimed — sent to your wallet.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              clear();
              void refetch();
            }}
          >
            Refresh
          </button>
        </p>
      )}
      {error && <p className="text-[11px] text-[var(--danger,#f87171)]">{error.message}</p>}
    </div>
  );
}

function Row({
  label,
  wei,
  loading,
  usd,
  busy,
  disabled,
  onClaim,
}: {
  label: string;
  wei: bigint | null;
  loading: boolean;
  usd: (wei: bigint) => string | null;
  busy: boolean;
  disabled: boolean;
  onClaim: () => void;
}) {
  const has = (wei ?? 0n) > 0n;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
      style={{ background: "var(--surface)" }}
    >
      <div className="min-w-0">
        <div className="text-[12px] text-[var(--text-secondary)]">{label}</div>
        <div className="num text-[15px] font-semibold text-[var(--text)]">
          {loading || wei === null ? "—" : `${fmtEth(wei)} ETH`}
        </div>
        {has && usd(wei!) && (
          <div className="num text-[11px] text-[var(--text-muted)]">{usd(wei!)}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClaim}
        disabled={!has || busy || disabled}
        className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "var(--text)", color: "var(--bg)" }}
      >
        {busy ? "Claiming…" : "Claim"}
      </button>
    </div>
  );
}
