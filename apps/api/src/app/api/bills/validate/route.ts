import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getPaymentProvider } from "@/payments";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getBiller, getServiceConfig } from "@/lib/bills";
import { billValidateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Validate a bill customer (e.g. electricity meter or cable smartcard). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    enforceRateLimit(`bill:validate:${auth.id}`, 20, 60_000);

    const body = billValidateSchema.parse(await req.json());
    const config = getServiceConfig(body.service);
    const biller = getBiller(body.service, body.billerId);
    if (!config || !biller) {
      throw new ApiError(422, "Unknown service or biller", "bad_biller");
    }

    const result = await getPaymentProvider().validateBillCustomer({
      flwBillerCode: biller.flwBillerCode,
      customer: body.customer,
    });
    if (!result.valid) {
      throw new ApiError(422, "Could not validate this customer", "invalid_customer");
    }
    return jsonOk({ valid: true, customerName: result.customerName ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
