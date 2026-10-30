import { prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
import { getFeatureFlags } from "@/lib/features";
import { broadcastPush } from "@/lib/push";
import { ensureNewsSchema } from "@/lib/ensureNews";
import { newsFeeds } from "@/lib/news/feeds";
import { parseRss } from "@/lib/news/rss";

export const dynamic = "force-dynamic";

/** Per feed: how many of the newest items to consider each run. */
const PER_FEED = 20;
/** Only push headlines this fresh, and at most this many per run (anti-spam). */
const BREAKING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BREAKING_PUSH_CAP = 2;

/**
 * Scheduled crypto-news job (Vercel Cron, CRON_SECRET). Pulls the configured
 * RSS feeds, stores any new headlines (deduped on url), and pushes the freshest
 * one or two as a `news` notification to opted-in users. No-ops when the
 * `crypto_news` feature flag is off.
 */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;

    if (!(await getFeatureFlags()).crypto_news) {
      return jsonOk({ ran: false, reason: "crypto_news disabled" });
    }

    await ensureNewsSchema();
    const feeds = newsFeeds();

    let inserted = 0;
    const fresh: { title: string; source: string; url: string; publishedAt: Date }[] = [];

    for (const feed of feeds) {
      try {
        const res = await fetch(feed.url, { headers: { "user-agent": "CheqPay-news/1.0" } });
        if (!res.ok) continue;
        const items = parseRss(await res.text()).slice(0, PER_FEED);
        for (const it of items) {
          const existing = await prisma.newsItem.findUnique({ where: { url: it.url }, select: { id: true } });
          if (existing) continue;
          const publishedAt = it.publishedAt ?? new Date();
          await prisma.newsItem.create({
            data: { source: feed.source, title: it.title, url: it.url, summary: it.summary, publishedAt },
          });
          inserted++;
          fresh.push({ title: it.title, source: feed.source, url: it.url, publishedAt });
        }
      } catch {
        /* one bad feed shouldn't fail the whole run */
      }
    }

    // Push only genuinely fresh headlines, newest first, capped — so the first
    // ever run (everything "new") doesn't fire a dozen notifications.
    const now = Date.now();
    const toPush = fresh
      .filter((f) => now - f.publishedAt.getTime() <= BREAKING_MAX_AGE_MS)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, BREAKING_PUSH_CAP);

    for (const f of toPush) {
      await broadcastPush({
        category: "news",
        title: `Crypto news · ${f.source}`,
        body: f.title,
        data: { url: f.url },
        url: "/(app)/news",
      });
    }

    return jsonOk({ ran: true, feeds: feeds.length, inserted, pushed: toPush.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
