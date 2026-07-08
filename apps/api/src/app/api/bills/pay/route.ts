import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { getBillsProvider } from "@/payments";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getBiller, getPlan, getServiceConfig } from "@/lib/bills";
import { billPaySchema } from "@/lib/validation";
import { sendPush } from "@/lib/push";
import { BillPaymentError } from "@/payments/types";
import { feeFromBps, getBillMarginBps } from "@/lib/settings";

import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * Pay a bill (airtime, data, electricity, cable TV, betting) from the user's
 * NGN balance. Money-safe:
 *   1. resolve biller + amount from the curated catalog
 *   2. atomically debit NGN (refuses overdraw) + record a PROCESSING BILL tx
 *   3. submit to the PSP; on failure, refund and mark FAILED
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("bill_payments");
    enforceRateLimit(`bill:pay:${auth.id}`, 10, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const body = billPaySchema.parse(await req.json());
    const config = getServiceConfig(body.service);
    const biller = getBiller(body.service, body.billerId);
    if (!config || !biller) {
      throw new ApiError(422, "Unknown service or biller", "bad_biller");
    }

    // Resolve the amount: variable services take `amount`; fixed take a plan.
    let amount: string;
    let planName: string | null = null;
    let flwItemCode: string | undefined;
    if (config.variableAmount) {
      if (!body.amount) throw new ApiError(422, "Amount is required", "no_amount");
      amount = body.amount;
    } else {
      if (!body.planId) throw new ApiError(422, "Plan is required", "no_plan");
      const plan = getPlan(body.service, body.planId);
      if (!plan || plan.billerId !== body.billerId) {
        throw new ApiError(422, "Unknown plan for this biller", "bad_plan");
      }
      amount = plan.amount;
      planName = plan.name;
      flwItemCode = plan.flwItemCode;
    }

    const amountMinor = toMinorUnits(amount, Asset.NGN);
    if (amountMinor <= 0n) {
      throw new ApiError(422, "Amount must be positive", "bad_amount");
    }

    // Resolve the PSP up front (before any debit). A misconfigured provider
    // throws here, safely, rather than after the user's balance is debited.
    const psp = getBillsProvider();

    // Business profit margin on bills (admin-set bps, default 0): the user is
    // debited amount + margin; the biller receives the bill amount.
    const marginMinor = feeFromBps(amountMinor, await getBillMarginBps());
    const totalMinor = amountMinor + marginMinor;

    // Idempotent replay.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    // Atomic debit + record. Rolls back on insufficient funds.
    const tx = await prisma.$transaction(async (db) => {
      const debit = await db.balance.updateMany({
        where: { userId: auth.id, asset: Asset.NGN, available: { gte: totalMinor } },
        data: { available: { decrement: totalMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");
      }
      return db.transaction.create({
        data: {
          userId: auth.id,
          type: TransactionType.BILL,
          asset: Asset.NGN,
          amount: amountMinor,
          fee: marginMinor,
          status: TransactionStatus.PROCESSING,
          idempotencyKey,
          metadata: {
            kind: "bill",
            service: body.service,
            billerId: biller.id,
            billerName: biller.name,
            customer: body.customer,
            planName,
          },
        },
      });
    });

    // Submit to the PSP. Refund + fail on error.
    try {
      const result = await psp.payBill({
        service: body.service,
        flwType: config.flwType,
        flwBillerCode: biller.flwBillerCode,
        flwItemCode,
        customer: body.customer,
        amount,
        reference: tx.id,
      });
      const status =
        result.status === "successful"
          ? TransactionStatus.COMPLETED
          : result.status === "failed"
            ? TransactionStatus.FAILED
            : TransactionStatus.PROCESSING;

      if (status === TransactionStatus.FAILED) {
        await refund(auth.id, totalMinor, tx.id);
        throw new ApiError(502, "Bill payment was declined; funds refunded", "bill_failed");
      }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status,
          externalRef: result.providerRef,
          metadata: {
            kind: "bill",
            service: body.service,
            billerId: biller.id,
            billerName: biller.name,
            customer: body.customer,
            planName,
            providerRef: result.providerRef,
            token: result.token ?? null,
          },
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "bill.paid",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: {
            service: body.service,
            biller: biller.name,
            amountMinor: amountMinor.toString(),
            providerRef: result.providerRef,
          },
        },
      });
      if (status === TransactionStatus.COMPLETED) {
        await sendPush(auth.id, {
          category: "bills",
          title: "Bill paid",
          body: `${biller.name} — ₦${fromMinorUnits(amountMinor, Asset.NGN)}${
            body.customer ? ` for ${body.customer}` : ""
          }.${result.token ? " Your recharge token is in the receipt." : ""}`,
          data: { transactionId: tx.id },
        });
      }

      return jsonOk({
        transactionId: tx.id,
        status: status === TransactionStatus.COMPLETED ? "completed" : "processing",
        providerRef: result.providerRef,
        token: result.token ?? null,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // Log the real cause (invisible to the client otherwise) and refund.
      console.error("[bills/pay] provider error", {
        transactionId: tx.id,
        service: body.service,
        billerId: biller.id,
        provider: psp.name,
        error: err instanceof Error ? err.message : String(err),
        providerMessage: err instanceof BillPaymentError ? err.providerMessage : undefined,
      });
      await refund(auth.id, totalMinor, tx.id);
      // Surface the PSP's own reason so the user knows *why* it failed and that
      // their money was returned.
      const reason =
        err instanceof BillPaymentError && err.providerMessage
          ? `Bill payment failed: ${err.providerMessage}. Your funds were refunded.`
          : "Bill payment could not be processed; funds refunded";
      throw new ApiError(502, reason, "bill_error");
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function refund(userId: string, amountMinor: bigint, txId: string) {
  await prisma.$transaction([
    prisma.balance.update({
      where: { userId_asset: { userId, asset: Asset.NGN } },
      data: { available: { increment: amountMinor } },
    }),
    prisma.transaction.update({
      where: { id: txId },
      data: { status: TransactionStatus.FAILED },
    }),
  ]);
}
