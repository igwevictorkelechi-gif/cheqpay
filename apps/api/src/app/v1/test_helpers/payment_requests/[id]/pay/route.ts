import { withApi } from "@/lib/devapi/handler";
import { resolveId } from "@/lib/devapi/inputs";
import { runIdempotent } from "@/lib/devapi/idempotency";
import {
  getPaymentRequest,
  paymentRequestObject,
  paymentRequestPaySchema,
  simulatePaymentRequestPayment,
} from "@/lib/devapi/paymentRequests";

export const dynamic = "force-dynamic";

/**
 * Test mode only: pretend the payer sent a bank transfer to a payment request's
 * account number. Credited exactly like a real payment (less the deposit fee);
 * sends payment_request.paid. Live keys get 404.
 */
export const POST = withApi(
  { scope: "payment_requests:write", body: paymentRequestPaySchema, testOnly: true, logFields: ["amount"] },
  async (ctx, params) => {
    const id = resolveId("payment_request", params.id, "id", "payment request");
    return runIdempotent(ctx, { id, ...ctx.body }, {
      replay: async (prId) => ({ body: paymentRequestObject((await getPaymentRequest(ctx.scope, prId))!) }),
      work: async (complete) => {
        const pr = await simulatePaymentRequestPayment(ctx.scope, id, ctx.body, (db, prId) => complete(db, "payment_request", prId, 201));
        return { status: 201, body: paymentRequestObject(pr) };
      },
    });
  },
);
