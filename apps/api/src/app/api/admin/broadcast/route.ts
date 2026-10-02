import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { broadcastPush } from "@/lib/push";
import { enforceRateLimit } from "@/lib/ratelimit";
import { broadcastSchema } from "@/lib/validation";

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
