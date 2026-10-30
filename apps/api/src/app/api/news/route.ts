import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureNewsSchema } from "@/lib/ensureNews";

export const dynamic = "force-dynamic";

/** Recent crypto-news headlines for the in-app feed, newest first. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("crypto_news");
    await ensureNewsSchema();

    const items = await prisma.newsItem.findMany({
      orderBy: { publishedAt: "desc" },
      take: 30,
      select: { id: true, source: true, title: true, url: true, summary: true, publishedAt: true },
    });

    return jsonOk({
      news: items.map((n) => ({
        id: n.id,
        source: n.source,
        title: n.title,
        url: n.url,
        summary: n.summary,
        publishedAt: n.publishedAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
