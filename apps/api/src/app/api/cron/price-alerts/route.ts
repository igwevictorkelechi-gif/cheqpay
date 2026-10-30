import { Asset, prisma } from "@cheqpay/db";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getPriceFeed } from "@/market";
import { cronRefusal } from "@/lib/cronAuth";
import { broadcastPush, sendPush } from "@/lib/push";
import { alertCrossed, prettyUsd } from "@/lib/priceAlerts";
import { ensurePriceAlertsSchema } from "@/lib/ensurePriceAlerts";

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
    const { PRICE_ALERT_THRESHOLD_PCT } = getEnv();
    // This job pushes to every opted-in user, so it never runs unauthenticated.
    const refused = cronRefusal(req);
    if (refused) return refused;

    const stateRow = await prisma.platformSetting.findUnique({ where: { key: STATE_KEY } });
    const state: AlertState = stateRow ? safeParse(stateRow.value) : {};

    const feed = getPriceFeed();
    const results: Array<{ asset: string; price: string; movePct: number; alerted: boolean }> = [];
    // Spot prices gathered this run, reused by the per-user alert pass below so
    // a watched asset isn't fetched twice.
    const spot: Partial<Record<Asset, number>> = {};

    for (const asset of WATCHED) {
      const price = await feed.getSpotUsdt(asset);
      const current = Number(price.toString());
      spot[asset] = current;
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

    // Per-user custom alerts: fire once when their target is crossed, then go
    // inactive (the user re-arms from the app). The push is gated by the user's
    // `price` opt-in inside sendPush.
    const userAlerts = await evaluateUserAlerts(feed, spot);

    return jsonOk({ ran: true, thresholdPct: PRICE_ALERT_THRESHOLD_PCT, results, userAlerts });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Evaluate every active per-user price alert against current spot prices. Each
 * crossed alert sends one push and is deactivated (one-shot). Spot is fetched
 * once per distinct asset, reusing anything the global pass already priced.
 */
async function evaluateUserAlerts(
  feed: ReturnType<typeof getPriceFeed>,
  spot: Partial<Record<Asset, number>>,
): Promise<{ evaluated: number; fired: number }> {
  await ensurePriceAlertsSchema();
  const alerts = await prisma.priceAlert.findMany({
    where: { active: true },
    select: { id: true, userId: true, asset: true, direction: true, targetUsd: true },
  });
  if (alerts.length === 0) return { evaluated: 0, fired: 0 };

  // Price each asset referenced by an alert, once.
  const prices = new Map<Asset, number>();
  for (const asset of new Set(alerts.map((a) => a.asset))) {
    if (spot[asset] != null) {
      prices.set(asset, spot[asset] as number);
      continue;
    }
    try {
      prices.set(asset, Number((await feed.getSpotUsdt(asset)).toString()));
    } catch {
      /* feed hiccup for this asset — skip it this run */
    }
  }

  let fired = 0;
  for (const a of alerts) {
    const price = prices.get(a.asset);
    if (price == null) continue;
    const target = Number(a.targetUsd.toString());
    if (!alertCrossed(a.direction, target, price)) continue;

    const up = a.direction === "ABOVE";
    await sendPush(a.userId, {
      category: "price",
      title: `${a.asset} ${up ? "hit" : "dropped to"} your target`,
      body: `${a.asset} is ${prettyUsd(price)} (your alert: ${up ? "≥" : "≤"} ${prettyUsd(target)}).`,
      data: { asset: a.asset, price, alertId: a.id },
    });
    await prisma.priceAlert.update({
      where: { id: a.id },
      data: { active: false, lastTriggeredAt: new Date() },
    });
    fired++;
  }
  return { evaluated: alerts.length, fired };
}

function safeParse(raw: string): AlertState {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as AlertState) : {};
  } catch {
    return {};
  }
}

