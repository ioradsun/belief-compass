/**
 * /analytics — the wallet-level export.
 *
 * One row per wallet, sorted by dollars in. Everything here answers a single
 * question the market-shaped metrics cannot: does anyone come back?
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminLogin, adminStatus } from "@/lib/admin.functions";
import { walletAnalytics } from "@/lib/wallet-analytics.functions";

export const Route = createFileRoute("/analytics")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Wallet analytics — Conviction" },
      {
        name: "description",
        content:
          "Wallet-level export: repeat use, concentration, hold times and the redeployment number.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Wallet analytics — Conviction" },
      { property: "og:description", content: "One row per wallet, not per market." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function holdLabel(secs: number) {
  if (secs < 90) return `${Math.round(secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)}m`;
  if (secs < 172800) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

function AnalyticsPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["admin-status"], queryFn: () => adminStatus() });
  const unlocked = status?.unlocked === true;
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const login = useMutation({
    mutationFn: async () => await adminLogin({ data: { password } }),
    onSuccess: (r) => {
      setFailed(!r.ok);
      if (r.ok) qc.invalidateQueries();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["wallet-analytics"],
    queryFn: () => walletAnalytics(),
    enabled: unlocked,
    staleTime: 60_000,
  });

  const csv = useMemo(() => {
    if (!data) return "";
    const head = [
      "wallet",
      "markets_traded",
      "total_trades",
      "buy_usd",
      "sell_usd",
      "sell_buy_ratio",
      "first_seen",
      "last_seen",
      "lifespan_days",
      "active_days",
      "median_hold_secs",
    ].join(",");
    const body = data.rows.map((r) =>
      [
        r.wallet,
        r.marketsTraded,
        r.totalTrades,
        r.buyUsd.toFixed(2),
        r.sellUsd.toFixed(2),
        r.sellBuyRatio == null ? "" : r.sellBuyRatio.toFixed(3),
        new Date(r.firstSeen).toISOString(),
        new Date(r.lastSeen).toISOString(),
        r.lifespanDays.toFixed(3),
        r.activeDays,
        Math.round(r.medianHoldSecs),
      ].join(","),
    );
    return [head, ...body].join("\n");
  }, [data]);

  if (!unlocked) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6 text-[var(--text)]">
        <form
          className="w-full max-w-[320px]"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <h1 className="text-[18px] font-semibold">Wallet analytics</h1>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mt-3 w-full rounded-md bg-[var(--surface)] px-3 py-2 text-[14px] outline-none"
            style={{ border: "1px solid var(--hairline)" }}
          />
          {failed && <p className="mt-2 text-[12px] text-[var(--no)]">Wrong password.</p>}
          <button
            type="submit"
            className="mt-3 w-full rounded-md bg-[var(--text)] px-3 py-2 text-[13px] font-medium text-[var(--bg)]"
          >
            Unlock
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-[1180px] overflow-y-auto bg-[var(--bg)] px-4 py-6 text-[var(--text)] lg:px-8">
      <header className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Wallet analytics</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          One row per wallet, sorted by dollars in. Markets are the wrong unit; this is the right
          one.
        </p>
        {data && (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            {data.tradeCount.toLocaleString("en-US")} canonical trades — including markets that were
            never titled. USD is ETH repriced at{" "}
            {data.ethUsd ? `$${data.ethUsd.toLocaleString("en-US")}/ETH` : "an unavailable rate"}{" "}
            {data.ethUsdUpdatedAt
              ? `(calibrated ${new Date(data.ethUsdUpdatedAt).toLocaleString()})`
              : ""}
            , <strong>not</strong> the rate at trade time — older volume is distorted by any move
            since.
          </p>
        )}
      </header>

      {isLoading && <p className="text-[13px] text-[var(--text-muted)]">Reading the ledger…</p>}
      {error && <p className="text-[13px] text-[var(--no)]">{(error as Error).message}</p>}

      {data && (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[
              { k: "Wallets", v: data.summary.wallets.toLocaleString("en-US") },
              { k: "Median markets / wallet", v: data.summary.medianMarketsTraded.toFixed(1) },
              {
                k: "Traded >1 market",
                v: `${data.summary.repeatWallets} (${
                  data.summary.wallets
                    ? Math.round((data.summary.repeatWallets / data.summary.wallets) * 100)
                    : 0
                }%)`,
              },
              { k: "Active >3 days", v: String(data.summary.returningWallets) },
              { k: "Top-10 share of buys", v: `${Math.round(data.summary.top10BuyShare * 100)}%` },
              { k: "Wash-shaped wallets", v: String(data.summary.washSuspectWallets) },
            ].map((c) => (
              <div
                key={c.k}
                className="rounded-lg bg-[var(--panel)] p-3"
                style={{ border: "1px solid var(--hairline)" }}
              >
                <div className="num text-[18px] font-semibold">{c.v}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">{c.k}</div>
              </div>
            ))}
          </section>

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Per wallet
            </h2>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
              download="wallet-analytics.csv"
              className="rounded-full px-3 py-1 text-[12px] font-medium text-[var(--text-secondary)]"
              style={{ border: "1px solid var(--border-strong)" }}
            >
              Download CSV
            </a>
          </div>

          <div
            className="overflow-x-auto rounded-lg bg-[var(--panel)]"
            style={{ border: "1px solid var(--hairline)" }}
          >
            <table className="w-full text-[12px]">
              <thead className="text-[var(--text-muted)]">
                <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                  {[
                    "Wallet",
                    "Markets",
                    "Trades",
                    "Buy $",
                    "Sell $",
                    "Sell/Buy",
                    "Lifespan (d)",
                    "Active days",
                    "Median hold",
                    "Last seen",
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.wallet} style={{ borderTop: "1px solid var(--hairline)" }}>
                    <td className="num whitespace-nowrap px-3 py-2">
                      {r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}
                    </td>
                    <td className="num px-3 py-2">{r.marketsTraded}</td>
                    <td className="num px-3 py-2">{r.totalTrades}</td>
                    <td className="num px-3 py-2">{usd(r.buyUsd)}</td>
                    <td className="num px-3 py-2">{usd(r.sellUsd)}</td>
                    <td className="num px-3 py-2">
                      {r.sellBuyRatio == null ? "—" : r.sellBuyRatio.toFixed(3)}
                    </td>
                    <td className="num px-3 py-2">{r.lifespanDays.toFixed(1)}</td>
                    <td className="num px-3 py-2">{r.activeDays}</td>
                    <td className="num px-3 py-2">{holdLabel(r.medianHoldSecs)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                      {new Date(r.lastSeen).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Side balances vs displayed split
          </h2>
          <div
            className="overflow-x-auto rounded-lg bg-[var(--panel)]"
            style={{ border: "1px solid var(--hairline)" }}
          >
            <table className="w-full text-[12px]">
              <thead className="text-[var(--text-muted)]">
                <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                  {["Market", "Holders", "YES $", "NO $", "Held YES %", "Displayed YES %"].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.splits.map((s) => (
                  <tr key={s.marketId} style={{ borderTop: "1px solid var(--hairline)" }}>
                    <td className="num px-3 py-2">{s.marketId}</td>
                    <td className="num px-3 py-2">{s.holders}</td>
                    <td className="num px-3 py-2">{usd(s.yesUsd)}</td>
                    <td className="num px-3 py-2">{usd(s.noUsd)}</td>
                    <td className="num px-3 py-2">
                      {s.splitPct == null ? "—" : `${s.splitPct.toFixed(1)}%`}
                    </td>
                    <td className="num px-3 py-2">
                      {s.displayedYesPct == null ? "—" : `${Number(s.displayedYesPct).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
