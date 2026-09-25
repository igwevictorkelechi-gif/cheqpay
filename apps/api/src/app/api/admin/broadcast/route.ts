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

    const sent = await broadcastPush({
      title: msg.title,
      body: msg.body,
      category: msg.category,
      url: msg.url,
      data: msg.url ? { url: msg.url } : {},
    });

    await recordAdminAction(req, actor, {
      action: "admin.broadcast.sent",
      summary: `Broadcast "${msg.title}" (${msg.category}) to ${sent} device(s)`,
      resourceType: "Broadcast",
      details: { ...msg, sent },
    });
    return jsonOk({ sent });
  } catch (err) {
    return toErrorResponse(err);
  }
}
