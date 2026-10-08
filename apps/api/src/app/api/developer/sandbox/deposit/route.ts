import { z } from "zod";
import { Asset } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { simulateDeposit } from "@/lib/devapi/deposits";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    virtual_account_id: z.string().max(80),
    amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 5000"),
    sender_name: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/** Sandbox: simulate a bank transfer into one of your test virtual accounts. Touches no real money. */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    await enforceRateLimit(`dev:sandbox-deposit:${s.account.id}`, 60, 60 * 60_000);
    const body = schema.parse(await req.json());
    const id = fromPublicId("virtual_account", body.virtual_account_id);
    if (!id) throw new ApiError(404, "No such virtual account.", "not_found");
    const amount = toMinorUnits(body.amount, Asset.NGN);
    if (amount <= 0n) throw new ApiError(400, "Enter an amount greater than zero.", "validation_error");
    const tx = await simulateDeposit({ accountId: s.account.id, mode: "test" }, id, amount, { name: body.sender_name });
    return jsonOk({ transaction: transactionObject(tx) }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
