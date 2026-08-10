import { getServiceSupabase } from "../../src/lib/service-supabase.server";
import { refreshMarket } from "../../src/lib/market-state/refresh-market.server";
const sb = getServiceSupabase();
const { data: eth } = await sb.rpc("eth_usd_calibration");
for (const m of [2813, 2815]) console.log(await refreshMarket(sb as any, m, Number(eth), 100));
