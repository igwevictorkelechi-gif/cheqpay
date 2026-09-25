import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getPaymentProvider } from "@/payments";
import { resolveAccountSchema } from "@/lib/validation";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Resolve the account holder's name for a NUBAN + bank code (pre-withdrawal). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    // Each lookup names an account holder and costs a provider call — cap it so
    // the endpoint can't be used to enumerate account names.
    await enforceRateLimit(`bank-resolve:${auth.id}`, 30, 60 * 60_000);
    const body = resolveAccountSchema.parse(await req.json());
    const { accountName } = await getPaymentProvider().resolveBankAccount(body);
    return jsonOk({ accountName });
  } catch (err) {
    return toErrorResponse(err);
  }
}
