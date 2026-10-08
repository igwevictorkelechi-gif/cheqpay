import { z } from "zod";
import { Asset } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { sandboxTopUp } from "@/lib/devapi/ledger";
import { walletObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    currency: z.enum(["NGN", "USD"]),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 50000"),
  })
  .strict();

/** Add simulated money to a sandbox main wallet. Test mode only; touches no real money. */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    await enforceRateLimit(`dev:sandbox-topup:${s.account.id}`, 30, 60 * 60_000);
    const body = schema.parse(await req.json());
    const wallet = await sandboxTopUp(s.account.id, body.currency, toMinorUnits(body.amount, body.currency === "NGN" ? Asset.NGN : Asset.USD));
    return jsonOk({ wallet: walletObject(wallet) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
