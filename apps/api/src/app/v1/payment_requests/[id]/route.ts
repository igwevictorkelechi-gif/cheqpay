import { withApi, V1Error } from "@/lib/devapi/handler";
import { resolveId } from "@/lib/devapi/inputs";
import { getPaymentRequest, paymentRequestObject } from "@/lib/devapi/paymentRequests";

export const dynamic = "force-dynamic";

/** One payment request and whether it has been paid. */
export const GET = withApi({ scope: "payment_requests:read" }, async (ctx, params) => {
  const id = resolveId("payment_request", params.id, "id", "payment request");
  const pr = await getPaymentRequest(ctx.scope, id);
  if (!pr) throw new V1Error(404, "No such payment request.", "not_found", "id");
  return { body: paymentRequestObject(pr) };
});
