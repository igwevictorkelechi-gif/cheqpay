import { Asset, prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
import { getFeatureFlags } from "@/lib/features";
import { getPriceFeed } from "@/market";
import { broadcastPush } from "@/lib/push";
import { prettyUsd } from "@/lib/priceAlerts";
import { ensureNewsSchema } from "@/lib/ensureNews";

export const dynamic = "force-dynamic";

const DIGEST_STATE = "daily_digest_state";

/**
 * The once-a-day "your crypto update" push — the guaranteed daily notification,
 * independent of whether the market moved or news broke. It runs once per day
 * (see vercel.json), which every Vercel plan supports, so the daily cadence
 * never depends on the Pro tier that the more-frequent alert crons need.
 *
 * One combined message under the `price` category (reaching everyone opted into
 * price alerts): the current BTC price with its move since yesterday, plus the
 * latest crypto headline when news is enabled. Auth: CRON_SECRET.
 */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;

    const flags = await getFeatureFlags();
    if (!flags.price_alerts) return jsonOk({ ran: false, reason: "price_alerts disabled" });

    // BTC spot + the day-over-day move, from a stored reference.
    const price = Number((await getPriceFeed().getSpotUsdt(Asset.BTC)).toString());
    const stateRow = await prisma.platformSetting.findUnique({ where: { key: DIGEST_STATE } });
    const prev = stateRow ? Number(JSON.parse(stateRow.value)?.btc ?? "0") : 0;
    const movePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    const moveStr = prev > 0 ? ` (${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}% today)` : "";

    await prisma.platformSetting.upsert({
      where: { key: DIGEST_STATE },
      update: { value: JSON.stringify({ btc: String(price), at: new Date().toISOString() }), updatedBy: "cron" },
      create: { key: DIGEST_STATE, value: JSON.stringify({ btc: String(price), at: new Date().toISOString() }), updatedBy: "cron" },
    });

    // Latest headline, when news is on and any have been pulled.
    let headline: string | null = null;
    if (flags.crypto_news) {
      await ensureNewsSchema();
      const latest = await prisma.newsItem.findFirst({
        orderBy: { publishedAt: "desc" },
        select: { title: true },
      });
      headline = latest?.title ?? null;
    }

    const body = `BTC is ${prettyUsd(price)}${moveStr}.${headline ? ` 📰 ${headline}` : ""}`;
    const sent = await broadcastPush({
      category: "price",
      title: "Your crypto update",
      body,
      data: { asset: "BTC", price },
      url: "/(app)/crypto",
    });

    return jsonOk({ ran: true, price, movePct: Number(movePct.toFixed(2)), headline, sent });
  } catch (err) {
    return toErrorResponse(err);
  }
}
