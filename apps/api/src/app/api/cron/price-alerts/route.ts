import { Asset, prisma } from "@cheqpay/db";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getPriceFeed } from "@/market";
import { broadcastPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const STATE_KEY = "price_alert_state";

// Assets worth watching for price alerts. USDT is a stablecoin (~$1) and never
// moves enough to trigger, so we watch BTC.
const WATCHED: Asset[] = [Asset.BTC];

type AlertState = Record<string, { ref: string; at: string }>;

/**
 * Scheduled price-alert job (Vercel Cron). On each run it compares the current
 * spot price of each watched asset against the reference stored at the last
 * alert. A move of at least PRICE_ALERT_THRESHOLD_PCT (default 5%) broadcasts a
 * `price` notification to opted-in users and resets the reference.
 *
 * Auth: gated by CRON_SECRET. Vercel Cron sends `Authorization: Bearer <secret>`
 * automatically when CRON_SECRET is configured on the project.
 */
export async function GET(req: Request) {
  try {
    const { CRON_SECRET, PRICE_ALERT_THRESHOLD_PCT } = getEnv();
    if (CRON_SECRET) {
      const auth = req.headers.get("authorization");
      const url = new URL(req.url);
      const key = url.searchParams.get("key");
      if (auth !== `Bearer ${CRON_SECRET}` && key !== CRON_SECRET) {
        return jsonOk({ error: "Unauthorized", code: "unauthorized" }, 401);
      }
    }

    const stateRow = await prisma.platformSetting.findUnique({ where: { key: STATE_KEY } });
    const state: AlertState = stateRow ? safeParse(stateRow.value) : {};

    const feed = getPriceFeed();
    const results: Array<{ asset: string; price: string; movePct: number; alerted: boolean }> = [];

    for (const asset of WATCHED) {
      const price = await feed.getSpotUsdt(asset);
      const current = Number(price.toString());
      const prev = state[asset]?.ref ? Number(state[asset].ref) : null;

      let alerted = false;
      let movePct = 0;
      if (prev && prev > 0) {
        movePct = ((current - prev) / prev) * 100;
        if (Math.abs(movePct) >= PRICE_ALERT_THRESHOLD_PCT) {
          const up = movePct >= 0;
          const pretty = current.toLocaleString("en-US", { maximumFractionDigits: 0 });
          await broadcastPush({
            category: "price",
            title: `${asset} is ${up ? "up" : "down"} ${Math.abs(movePct).toFixed(1)}%`,
            body: `${asset} is now $${pretty}. Tap to buy, sell or convert.`,
            data: { asset, price: current },
          });
          state[asset] = { ref: String(current), at: new Date().toISOString() };
          alerted = true;
        }
      } else {
        // First observation — establish the reference without alerting.
        state[asset] = { ref: String(current), at: new Date().toISOString() };
      }

      results.push({ asset, price: String(current), movePct: Number(movePct.toFixed(2)), alerted });
    }

    await prisma.platformSetting.upsert({
      where: { key: STATE_KEY },
      update: { value: JSON.stringify(state), updatedBy: "cron" },
      create: { key: STATE_KEY, value: JSON.stringify(state), updatedBy: "cron" },
    });

    return jsonOk({ ran: true, thresholdPct: PRICE_ALERT_THRESHOLD_PCT, results });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function safeParse(raw: string): AlertState {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as AlertState) : {};
  } catch {
    return {};
  }
}
