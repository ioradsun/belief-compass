/**
 * check-signal-corpus — diagnostic-before-influential review of SignalVector.
 *
 * Computes `signalVector()` over the real corpus WITHOUT wiring it into
 * ranking, cadence or copy, and prints:
 *   top 20 / bottom 20 by informationGain, plus every non-zero
 *   tension / beforePrice / concentration / nonresponse case,
 * each with its underlying facts, all signal values and every reason.
 *
 * Run:  npx tsx scripts/check-signal-corpus.ts   (npm run check:signal-corpus)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import {
  signalVector,
  holdersBefore,
  type SignalFacts,
  type SignalVector,
  type CanonicalTrade,
} from "../src/domain/signal-vector";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    `Missing ${[!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(" and ")}.`,
  );
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const HOUR = 3_600_000;
const nowMs = Date.now();

type Row = {
  marketId: string;
  title: string;
  label: string;
  facts: SignalFacts;
  vector: SignalVector;
};

async function main() {
  const { data: cal } = await sb
    .from("calc_cache")
    .select("value")
    .eq("key", "eth_usd")
    .maybeSingle();
  const ethUsd = Number((cal?.value as { usd?: number } | number | null) ?? 0) || 0;
  const rate =
    typeof cal?.value === "object" && cal?.value !== null
      ? Number((cal.value as Record<string, unknown>)["usd"] ?? 0)
      : ethUsd;
  if (!rate) {
    console.error("No eth_usd calibration — dollar facts would all be zero. Aborting.");
    process.exit(1);
  }
  const usd = (wei: unknown) => (Number(wei ?? 0) / 1e18) * rate;

  const { data: states, error } = await sb
    .from("market_state")
    .select(
      "onchain_id, yes_price_usd, yes_price_change_1h, yes_price_change_24h, yes_price_change_7d," +
        " yes_capital_delta_24h, no_capital_delta_24h, capital_held_yes, capital_held_no," +
        " trade_count_24h, trade_count_7d, believers_yes, believers_no, new_believers_24h," +
        " people_yes_change_24h, side_flips_24h, last_trade_at",
    )
    .or("trade_count_7d.gt.0,trade_count_24h.gt.0")
    .limit(600);
  if (error) throw error;

  const ids = ((states ?? []) as unknown as Record<string, any>[]).map((s) =>
    String(s.onchain_id),
  );

  const { data: markets } = await sb
    .from("markets")
    .select("onchain_id, question")
    .in("onchain_id", ids.map(Number));
  const titleById = new Map(
    (markets ?? []).map((m) => [String(m.onchain_id), String(m.question ?? "")]),
  );

  // All-time canonical trades for these markets — the proven route to a
  // pre-event holder hierarchy (2a: reconstruction matches wallet_beliefs).
  const tradesByMarket = new Map<string, CanonicalTrade[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    let from = 0;
    for (;;) {
      const { data, error: te } = await sb
        .from("events")
        .select("market_id, wallet, action, amount_eth, occurred_at")
        .eq("kind", "trade")
        .eq("is_canonical", true)
        .in("market_id", chunk)
        .order("occurred_at", { ascending: true })
        .range(from, from + 999);
      if (te) throw te;
      for (const e of data ?? []) {
        const list = tradesByMarket.get(String(e.market_id)) ?? [];
        const amount = usd(e.amount_eth);
        list.push({
          wallet: String(e.wallet ?? "").toLowerCase(),
          netUsd: e.action === "SELL" ? -amount : amount,
          atMs: Date.parse(String(e.occurred_at)),
        });
        tradesByMarket.set(String(e.market_id), list);
      }
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }

  const rows: Row[] = [];
  // The generated row type does not cover this hand-written projection.
  const stateRows = (states ?? []) as unknown as Record<string, any>[];
  for (const s of stateRows) {

    const id = String(s.onchain_id);
    const title = titleById.get(id) || `Market #${id}`;
    const trades = tradesByMarket.get(id) ?? [];
    const recent = trades.filter((t) => t.atMs >= nowMs - 24 * HOUR);

    const marketFacts: SignalFacts = {
      yesPrice: s.yes_price_usd,
      yesPriceChange1h: s.yes_price_change_1h,
      yesPriceChange24h: s.yes_price_change_24h,
      yesPriceChange7d: s.yes_price_change_7d,
      yesCapitalDelta24h: s.yes_capital_delta_24h,
      noCapitalDelta24h: s.no_capital_delta_24h,
      capitalHeldYes: s.capital_held_yes,
      capitalHeldNo: s.capital_held_no,
      tradeCount24h: s.trade_count_24h,
      tradeCount7d: s.trade_count_7d,
      believersYes: s.believers_yes,
      believersNo: s.believers_no,
      newBelievers24h: s.new_believers_24h,
      peopleYesChange24h: s.people_yes_change_24h,
      sideFlips24h: s.side_flips_24h,
      newcomers24h: s.new_believers_24h,
      nowMs,
    };

    // Nonresponse candidate: the biggest single input inside the window.
    const inputs = trades.filter(
      (t) =>
        t.netUsd > 0 && t.atMs <= nowMs - 4 * HOUR && t.atMs >= nowMs - 36 * HOUR,
    );
    const biggest = inputs.sort((a, b) => b.netUsd - a.netUsd)[0];
    if (biggest) {
      marketFacts.input = { amountUsd: biggest.netUsd, atMs: biggest.atMs };
    }

    rows.push({
      marketId: id,
      title,
      label: "market",
      facts: marketFacts,
      vector: signalVector(marketFacts),
    });

    // One actor row per trade in the last 24h, with the reconstructed
    // pre-event hierarchy attached.
    for (const t of recent) {
      const facts: SignalFacts = {
        ...marketFacts,
        input: null,
        actor: {
          wallet: t.wallet,
          direction: t.netUsd < 0 ? "sell" : "buy",
          amountUsd: Math.abs(t.netUsd),
        },
        preEventHolders: holdersBefore(trades, t.atMs),
      };
      rows.push({
        marketId: id,
        title,
        label: `trade ${t.netUsd < 0 ? "SELL" : "BUY"} $${Math.abs(t.netUsd).toFixed(2)} by ${t.wallet.slice(0, 8)} ${((nowMs - t.atMs) / HOUR).toFixed(1)}h ago`,
        facts,
        vector: signalVector(facts),
      });
    }
  }

  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : typeof n === "number" ? n.toFixed(4).replace(/\.?0+$/, "") : String(n);

  const print = (r: Row) => {
    const f = r.facts;
    const v = r.vector;
    console.log(
      `\n#${r.marketId} ${r.title.slice(0, 72)}\n  row: ${r.label}` +
        `\n  facts: price=${fmt(f.yesPrice)} Δ24h=${fmt(f.yesPriceChange24h)} ` +
        `rel=${f.yesPrice && f.yesPriceChange24h ? ((Math.abs(f.yesPriceChange24h) / f.yesPrice) * 100).toFixed(2) + "%" : "—"} ` +
        `trades24h=${fmt(f.tradeCount24h)} trades7d=${fmt(f.tradeCount7d)} ` +
        `yesΔ$=${fmt(f.yesCapitalDelta24h)} noΔ$=${fmt(f.noCapitalDelta24h)} ` +
        `newBelievers=${fmt(f.newBelievers24h)} peopleΔ=${fmt(f.peopleYesChange24h)} flips=${fmt(f.sideFlips24h)} ` +
        `holdersBefore=${f.preEventHolders?.length ?? "—"} input=${f.input ? `$${f.input.amountUsd.toFixed(0)}@${((nowMs - f.input.atMs) / HOUR).toFixed(1)}h` : "—"}` +
        `\n  signals: ` +
        Object.entries(v.signals)
          .map(([k, n]) => `${k}=${n.toFixed(3)}`)
          .join(" ") +
        `\n  gain=${v.informationGain.toFixed(4)} primary=${v.primary}` +
        (v.tensionKind ? ` tension=${v.tensionKind}` : "") +
        (v.concentrationKind ? ` concentration=${v.concentrationKind}` : "") +
        `\n  reasons:\n${v.reasons.map((x) => `    - ${x}`).join("\n") || "    (none)"}`,
    );
  };

  const section = (name: string, list: Row[]) => {
    console.log(`\n\n══════ ${name} (${list.length}) ══════`);
    list.forEach(print);
  };

  const ranked = [...rows].sort((a, b) => b.vector.informationGain - a.vector.informationGain);
  console.log(
    `Corpus: ${rows.length} candidate rows across ${(states ?? []).length} active markets. ` +
      `eth_usd=${rate}. Non-zero gain: ${rows.filter((r) => r.vector.informationGain > 0).length}.`,
  );
  section("TOP 20 BY informationGain", ranked.slice(0, 20));
  section("BOTTOM 20 BY informationGain", ranked.slice(-20));
  section("NON-ZERO tension", rows.filter((r) => r.vector.signals.tension > 0));
  section("NON-ZERO beforePrice", rows.filter((r) => r.vector.signals.beforePrice > 0));
  section("NON-ZERO concentration", rows.filter((r) => r.vector.signals.concentration > 0));
  section("NON-ZERO nonresponse", rows.filter((r) => r.vector.signals.nonresponse > 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
