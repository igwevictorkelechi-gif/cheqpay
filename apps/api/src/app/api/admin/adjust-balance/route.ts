import { z } from "zod";
import { Asset, TransactionStatus, TransactionType, UserStatus, prisma } from "@cheqpay/db";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { adminCreditHeadroom } from "@/lib/adminCreditCap";
import { ensureUsdAsset } from "@/lib/ensureUsdAsset";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

const adjustSchema = z.object({
  email: z.string().email(),
  // USD included: dollar balances are real now (FX converts and offramped
  // crypto deposits both land there), and an asset an operator cannot correct
  // is an asset with no way back out of a mistake.
  asset: z.enum(["NGN", "USD", "BTC", "USDT", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(200),
  otp: z.string().min(6).max(8),
});

/**
 * Admin: credit or debit a user's balance.
 *
 * A credit here creates money from nothing, so it is the most guarded action in
 * the dashboard:
 *  - Super Admin, named: the audit and the alert say which admin.
 *  - A fresh authenticator code per call.
 *  - Credits only to an ACTIVE account with verified identity (tier 1+).
 *  - A rolling 24-hour cap per asset across ALL admin credits, set in the
 *    deployment's environment — so a dashboard session, however it was
 *    obtained, cannot raise its own ceiling. On 22 Sep 10,000 USDT and 1 BTC
 *    were credited in seventeen seconds; the default caps stop that cold.
 *  - Announced to the ops webhook and security email as it happens.
 * Debits (taking money back) keep the OTP but skip the cap and the tier rule.
 */
export async function POST(req: Request) {
  try {
    const actorInfo = await requireAdminActor(req, { superOnly: true });
    const actor = actorInfo.email;
    const body = adjustSchema.parse(await req.json());

    await requireAdminOtp(req, body.otp);

    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) throw new ApiError(404, "No user with that email", "user_not_found");

    const asset = body.asset as Asset;
    const amountMinor = toMinorUnits(body.amount, asset);
    if (amountMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");

    if (body.direction === "credit") {
      if (user.status !== UserStatus.ACTIVE) {
        throw new ApiError(422, `This account is ${user.status.toLowerCase()} — it can't be credited.`, "account_not_active");
      }
      if (user.kycTier < 1) {
        throw new ApiError(422, "This account hasn't verified its identity — it can't be credited.", "account_unverified");
      }
      const headroom = await adminCreditHeadroom(asset);
      if (amountMinor > headroom.remainingMinor) {
        throw new ApiError(
          422,
          `That's over the 24-hour admin credit limit for ${asset}. ` +
            `Limit ${fromMinorUnits(headroom.limitMinor, asset)}, already credited ` +
            `${fromMinorUnits(headroom.usedMinor, asset)}, remaining ${fromMinorUnits(headroom.remainingMinor, asset)}.`,
          "admin_credit_cap",
        );
      }
    }

    // Migrations are not applied on deploy, so USD is added to the Asset enum
    // lazily — and Postgres will not accept a value in the same transaction that
    // added it, so this runs before the write below rather than inside it.
    if (asset === Asset.USD) await ensureUsdAsset();

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

    const human = `${fromMinorUnits(amountMinor, asset)} ${asset}`;
    await recordAdminAction(req, actorInfo, {
      action: `admin.balance.${body.direction}`,
      summary: `${body.direction === "credit" ? "Credited" : "Debited"} ${human} ${body.direction === "credit" ? "to" : "from"} ${user.email}`,
      userId: user.id,
      resourceType: "Transaction",
      resourceId: tx.id,
      details: { asset, amountMinor: amountMinor.toString(), reason: body.reason },
    });

    await notifyUser(user.id, {
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
