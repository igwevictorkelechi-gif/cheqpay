import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * Resolve a username so the sender can confirm who they are paying before any
 * money moves — the same "is this the right person?" step the bank-transfer
 * flow gets from name enquiry.
 *
 * Deliberately returns only the username and a display name: never the email,
 * phone, balance or id. Rate limited because this endpoint is inherently
 * enumerable, and it requires a session so it is not open to the internet.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("p2p_transfers");
    enforceRateLimit(`user:lookup:${auth.id}`, 30, 60_000);

    const raw = new URL(req.url).searchParams.get("username") ?? "";
    const username = raw.trim().replace(/^@+/, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      throw new ApiError(422, "Enter a valid username", "bad_username");
    }

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: { id: true, username: true, status: true, kycRecords: false },
    });
    if (!user || !user.username) {
      throw new ApiError(404, "No CheqPay user with that username", "user_not_found");
    }
    if (user.status !== "ACTIVE") {
      throw new ApiError(422, "That account can't receive transfers", "recipient_inactive");
    }
    if (user.id === auth.id) {
      throw new ApiError(422, "That's your own username", "self_transfer");
    }

    return jsonOk({ username: user.username, self: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}
