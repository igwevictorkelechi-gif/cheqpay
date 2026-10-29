import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { payLink, payToken } from "@/lib/payLink";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own pay link and QR value, for the "My code" screen.
 *
 * The token is derived from a server secret, so only the server can mint the
 * link the public endpoint will accept — the app fetches it here rather than
 * building it itself. A user with no username yet gets a 409 so the app can
 * send them to set one.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("p2p_transfers");

    const me = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { username: true },
    });
    if (!me?.username) {
      throw new ApiError(409, "Set a username first to get your pay link", "username_required");
    }

    return jsonOk({
      username: me.username,
      link: payLink(me.username),
      token: payToken(me.username),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
