import { z } from "zod";
import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { consumeAdminOtp, isAdminOtpConfigured } from "@/lib/totp";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const adjustSchema = z.object({
  email: z.string().email(),
  asset: z.enum(["NGN", "BTC", "USDT", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().trim().min(3).max(200),
  otp: z.string().min(6).max(8),
});

/**
 * Admin: credit or debit a user's balance. Every call must carry a fresh
 * authenticator-app OTP (single-use, verified server-side) — an admin session
 * alone cannot move money. Fully ledgered: writes a COMPLETED transaction row
 * with the reason + acting admin, plus an audit entry, and notifies the user.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const body = adjustSchema.parse(await req.json());

    if (!(await isAdminOtpConfigured())) {
      throw new ApiError(
        403,
        "Transaction OTP is not set up. Configure it on the Adjust Balance page first.",
        "otp_not_configured"
      );
    }
    if (!(await consumeAdminOtp(body.otp))) {
      throw new ApiError(401, "Invalid or already-used OTP code.", "bad_otp");
    }

    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) throw new ApiError(404, "No user with that email", "user_not_found");

    const asset = body.asset as Asset;
    const amountMinor = toMinorUnits(body.amount, asset);
    if (amountMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");

    const idempotencyKey = `admin-adjust:${crypto.randomUUID()}`;
    const metadata = {
      kind: "admin_adjustment",
      direction: body.direction,
      reason: body.reason,
      admin: actor,
    };

    const tx = await prisma.$transaction(async (db) => {
      if (body.direction === "credit") {
        await db.balance.upsert({
          where: { userId_asset: { userId: user.id, asset } },
          update: { available: { increment: amountMinor } },
          create: { userId: user.id, asset, available: amountMinor },
        });
      } else {
        const debit = await db.balance.updateMany({
          where: { userId: user.id, asset, available: { gte: amountMinor } },
          data: { available: { decrement: amountMinor } },
        });
        if (debit.count !== 1) {
          throw new ApiError(422, "User has insufficient available balance", "insufficient_funds");
        }
      }
      return db.transaction.create({
        data: {
          userId: user.id,
          type: body.direction === "credit" ? TransactionType.DEPOSIT : TransactionType.WITHDRAWAL,
          asset,
          amount: amountMinor,
          status: TransactionStatus.COMPLETED,
          idempotencyKey,
          metadata,
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: `admin.balance.${body.direction}`,
        resourceType: "Transaction",
        resourceId: tx.id,
        details: { asset, amountMinor: amountMinor.toString(), reason: body.reason, actor },
      },
    });

    const human = `${fromMinorUnits(amountMinor, asset)} ${asset}`;
    await sendPush(user.id, {
      category: body.direction === "credit" ? "deposits" : "withdrawals",
      title: body.direction === "credit" ? "Account credited" : "Account debited",
      body:
        body.direction === "credit"
          ? `${human} was added to your wallet by CheqPay. Reason: ${body.reason}`
          : `${human} was deducted from your wallet by CheqPay. Reason: ${body.reason}`,
      data: { transactionId: tx.id },
    });

    return jsonOk({
      transactionId: tx.id,
      email: user.email,
      asset,
      amount: fromMinorUnits(amountMinor, asset),
      direction: body.direction,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
