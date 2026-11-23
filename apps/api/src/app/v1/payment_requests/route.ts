import { withApi } from "@/lib/devapi/handler";
import { createPaymentRequest, listPaymentRequests, paymentRequestCreateSchema, paymentRequestObject } from "@/lib/devapi/paymentRequests";

export const dynamic = "force-dynamic";

/** Your payment requests in this mode, newest first. */
export const GET = withApi({ scope: "payment_requests:read" }, async (ctx) => {
  const page = await listPaymentRequests(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(paymentRequestObject) } };
});

/**
 * A one-off account number for one expected payment, paid by anyone by bank
 * transfer (no customer, no KYC on the payer). Money that arrives credits your
 * main NGN wallet and sends payment_request.paid.
 */
export const POST = withApi(
  { scope: "payment_requests:write", body: paymentRequestCreateSchema, logFields: ["amount", "expires_in", "reference"] },
  (ctx) => createPaymentRequest(ctx),
);
