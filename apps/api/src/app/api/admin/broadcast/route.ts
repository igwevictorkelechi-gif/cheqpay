import { prisma } from "@cheqpay/db";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { broadcastPush } from "@/lib/push";
import { enforceRateLimit } from "@/lib/ratelimit";
import { broadcastSchema } from "@/lib/validation";
import { messagesStats } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/**
 * Admin: send a notification to every user who allows the category — on their
 * phones (Expo) and in their browsers (Web Push).
 *
 * It reaches the whole customer base at once, so it is guarded like any other
 * high-impact admin action: a named admin, a fresh authenticator code, an
 * audit record, and at most one send a minute.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    await enforceRateLimit("admin-broadcast", 1, 60_000);
    const msg = broadcastSchema.parse(await req.json());

    const result = await broadcastPush({
      title: msg.title,
      body: msg.body,
      category: msg.category,
      url: msg.url,
      data: msg.url ? { url: msg.url } : {},
    });
    // "Sent" = accepted by Apple/Google/Expo. Whether phones showed it comes
    // back as receipts, read from GET /api/admin/broadcast/:id.
    const sent = result.browsers + result.apps;

    await recordAdminAction(req, actor, {
      action: "admin.broadcast.sent",
      summary: `Broadcast "${msg.title}" (${msg.category}) to ${sent} device(s)`,
      resourceType: "Broadcast",
      resourceId: result.id,
      details: { ...msg, sent, browsers: result.browsers, apps: result.apps, id: result.id },
    });
    return jsonOk({ sent, id: result.id, browsers: result.browsers, apps: result.apps });
  } catch (err) {
    return toErrorResponse(err);
  }
}

type SentDetails = {
  id?: string; title?: string; body?: string; category?: string; url?: string;
  sent?: number; browsers?: number; apps?: number; actor?: string;
};

/**
 * Admin: every notification sent from the dashboard, newest first — what it
 * said, who sent it, how many devices it went to, and (for browsers and the
 * installed web app) how many showed it and how many people tapped it.
 * Read from the audit trail, so it includes sends from before this list existed.
 */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const rows = await prisma.auditLog.findMany({
      where: { action: "admin.broadcast.sent" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, createdAt: true, details: true, resourceId: true },
    });
    const items = rows.map((r) => ({ r, d: (r.details ?? {}) as SentDetails }));
    const stats = await messagesStats(items.map(({ r, d }) => d.id ?? r.resourceId ?? "").filter(Boolean)).catch(() => new Map());
    return jsonOk({
      broadcasts: items.map(({ r, d }) => {
        const msgId = d.id ?? r.resourceId ?? null;
        const s = msgId ? stats.get(msgId) : undefined;
        return {
          id: r.id,
          messageId: msgId,
          sentAt: r.createdAt.toISOString(),
          sentBy: d.actor ?? null,
          title: d.title ?? "",
          body: d.body ?? "",
          category: d.category ?? "updates",
          url: d.url ?? null,
          devices: d.sent ?? null,
          browsers: d.browsers ?? null,
          apps: d.apps ?? null,
          shown: s ? s.delivered : null,
          tapped: s ? s.opened : null,
        };
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
