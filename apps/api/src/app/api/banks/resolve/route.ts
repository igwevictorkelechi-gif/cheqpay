import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getPaymentProvider } from "@/payments";
import { resolveAccountSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Resolve the account holder's name for a NUBAN + bank code (pre-withdrawal). */
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const body = resolveAccountSchema.parse(await req.json());
    const { accountName } = await getPaymentProvider().resolveBankAccount(body);
    return jsonOk({ accountName });
  } catch (err) {
    return toErrorResponse(err);
  }
}
