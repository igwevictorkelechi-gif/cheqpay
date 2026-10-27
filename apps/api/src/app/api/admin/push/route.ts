import { z } from "zod";
import { requireAdminActor } from "@/lib/adminGuard";
import {
  adminPushPublicKey,
  isAdminSubscribed,
  removeAdminSubscription,
  saveAdminSubscription,
} from "@/lib/adminPush";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

// Alerts on the admin dashboard: the signed-in admin's own browsers only. Who
// gets which alert is decided when it is sent, from their current access, so a
// sub admin who loses Gift cards stops hearing about gift cards at once.

const endpointSchema = z
  .string()
  .url()
  .max(1000)
  .refine((u) => u.startsWith("https://"), "Push endpoints are https");

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema,
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  }),
});

/** The key to subscribe with, and whether this browser (?endpoint=) already is. */
export async function GET(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const endpoint = new URL(req.url).searchParams.get("endpoint");
    const ok = endpoint ? endpointSchema.safeParse(endpoint).success : false;
    return jsonOk({
      publicKey: adminPushPublicKey(),
      subscribed: ok ? await isAdminSubscribed(actor.email, endpoint!) : false,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Turn alerts on for this browser. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    await enforceRateLimit(`admin:push:${actor.email}`, 20, 60 * 60_000);
    if (!adminPushPublicKey()) throw new ApiError(503, "Alerts aren't set up on this server.", "push_unavailable");
    const { subscription } = subscribeSchema.parse(await req.json());
    await saveAdminSubscription(actor.email, subscription, req.headers.get("user-agent"));
    return jsonOk({ subscribed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Turn alerts off for this browser. */
export async function DELETE(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const { endpoint } = z.object({ endpoint: endpointSchema }).parse(await req.json());
    await removeAdminSubscription(actor.email, endpoint);
    return jsonOk({ subscribed: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}
