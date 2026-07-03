import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getPaymentProvider } from "@/payments";

export const dynamic = "force-dynamic";

/** List NG banks the user can withdraw to (for the payout picker). */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const banks = await getPaymentProvider().listBanks();
    return jsonOk({ banks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
