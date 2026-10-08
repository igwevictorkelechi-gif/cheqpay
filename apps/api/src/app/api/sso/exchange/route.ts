import { prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requestContext } from "@/lib/requestContext";
import { redeemHandoff } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * "Continue with CheqPay", step 3: the site the user came from redeems the code
 * with the verifier only it holds, and gets a one-time Supabase sign-in token
 * to start its own session. No session needed: the code and verifier are the
 * proof.
 */
export async function POST(req: Request) {
  try {
    const { ip } = requestContext(req);
    await enforceRateLimit(`sso-exchange:${ip ?? "unknown"}`, 30, 60_000);
    const body = (await req.json().catch(() => ({}))) as { client?: unknown; code?: unknown; verifier?: unknown };
    const { userId, tokenHash } = await redeemHandoff({ client: body.client, code: body.code, verifier: body.verifier });
    await prisma.auditLog.create({
      data: { userId, action: "sso.exchange", resourceType: "SsoClient", resourceId: String(body.client), details: { ip } },
    });
    return jsonOk({ token_hash: tokenHash, type: "magiclink" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
