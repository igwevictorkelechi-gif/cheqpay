import { withApi } from "@/lib/devapi/handler";
import { billPaymentSchema, createBillPayment } from "@/lib/devapi/bills";
import { listTransactions } from "@/lib/devapi/lists";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** Bill payments in this mode, newest first. Filter by status, wallet, customer or reference. */
export const GET = withApi({ scope: "bills:read" }, async (ctx) => {
  const page = await listTransactions(ctx.scope, ctx.query, { kind: "bill_payment" });
  return { body: { ...page, data: page.data.map(transactionObject) } };
});

/**
 * Pay a bill from an NGN wallet (your main wallet unless you name one). Answers
 * 201 when it settled at once (successful or failed and refunded), or 202 while
 * the biller confirms; watch for bill_payment.successful / bill_payment.failed.
 */
export const POST = withApi(
  {
    scope: "bills:write",
    body: billPaymentSchema,
    moneyMoving: true,
    logFields: ["service", "biller_id", "plan_id", "amount", "wallet_id", "reference"],
  },
  (ctx) => createBillPayment(ctx, ctx.ip),
);
