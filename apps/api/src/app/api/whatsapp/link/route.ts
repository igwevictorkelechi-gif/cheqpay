// apps/api/src/app/api/whatsapp/link/route.ts
//
// Connecting and disconnecting WhatsApp, from Settings → Security.
//
// Linking HAS to start here rather than in the chat, because a phone number
// proves nothing on its own: User.phone is nullable, unverified, un-normalised,
// and dropped on collision. A code minted by a signed-in session and sent from
// the user's own WhatsApp proves both halves.

import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requestContext } from "@/lib/requestContext";
import { notifyUser } from "@/lib/alerts";
import { createLinkCode, linkStatus, unlinkByUser } from "@/lib/whatsapp/session";

export const dynamic = "force-dynamic";

/** Is WhatsApp connected, and to which (masked) number? */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk(await linkStatus(auth.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Mint a one-time code to send to the bot. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("whatsapp_bot");
    await enforceRateLimit(`wa-link-code:${auth.id}`, 5, 10 * 60_000);
    const code = await createLinkCode(auth.id);
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "whatsapp.link_code",
        resourceType: "WhatsappLink",
        resourceId: auth.id,
        details: { ip: requestContext(req).ip },
      },
    });
    return jsonOk(code);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Disconnect. Always reports success so the UI can be unconditional. */
export async function DELETE(req: Request) {
  try {
    const auth = await requireUser(req);
    const removed = await unlinkByUser(auth.id);
    if (removed) {
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "whatsapp.unlinked",
          resourceType: "WhatsappLink",
          resourceId: auth.id,
          details: { ip: requestContext(req).ip, via: "app" },
        },
      });
      // Announced on the other channels too: if the unlink wasn't the user's
      // doing, this is how they find out.
      await notifyUser(auth.id, {
        title: "WhatsApp disconnected",
        body: "WhatsApp can no longer see your CheqPay account.",
        category: "security",
      }).catch(() => undefined);
    }
    return jsonOk({ linked: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}
