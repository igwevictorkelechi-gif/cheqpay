import { prisma } from "@cheqpay/db";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { assertFeatureEnabled } from "@/lib/features";
import { clientIp } from "@/lib/requestContext";
import { payTokenValid } from "@/lib/payLink";
import { getVirtualAccount } from "@/lib/virtualAccounts";

export const dynamic = "force-dynamic";

/**
 * Public pay-target lookup for a CheqPay QR / pay link.
 *
 * Powers the web `/pay/<username>` page and the app's pre-fill when someone
 * opens another user's code. It returns only what that user already hands out
 * to get paid — their username, the name their bank shows, and their Naira
 * account number + bank — and NEVER email, phone, balance or id.
 *
 * Not behind a session, because the whole point is that a payer without the app
 * can reach it. Two things stop it becoming an enumeration oracle:
 *  - the `c` token must match the one issued for this username (see payLink.ts),
 *    so you can resolve a link you were given but not walk the username space;
 *  - it is rate limited per IP.
 * A missing/wrong token, an unknown user, or an inactive one all return the same
 * 404, so the endpoint never confirms whether a username exists.
 */
export async function GET(req: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    await assertFeatureEnabled("p2p_transfers");
    await enforceRateLimit(`pay:lookup:${clientIp(req) ?? "anon"}`, 30, 60_000);

    const { username: raw } = await params;
    const username = (raw ?? "").trim().replace(/^@+/, "");
    const notFound = new ApiError(404, "No CheqPay user with that link", "pay_target_not_found");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw notFound;

    const token = new URL(req.url).searchParams.get("c");
    if (!payTokenValid(username, token)) throw notFound;

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: { id: true, username: true, status: true },
    });
    if (!user || !user.username || user.status !== "ACTIVE") throw notFound;

    const va = await getVirtualAccount(user.id);
    return jsonOk({
      username: user.username,
      displayName: va?.accountName ?? null,
      ngn: va ? { bankName: va.bankName, accountNumber: va.accountNumber } : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
