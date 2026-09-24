import { Asset, Network, TransactionType, UserStatus, prisma } from "@cheqpay/db";
import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { adminCreditHeadroom } from "@/lib/adminCreditCap";
import { isPlausibleTxHash } from "@/lib/txHashFormat";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { creditBalance } from "@/lib/ledger";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { getManualWallets, MANUAL_ASSETS, type ManualAsset } from "@/lib/manualCrypto";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

const creditSchema = z.object({
  /** User's email (easier to type from the dashboard than a UUID). */
  email: z.string().email(),
  asset: z.enum(["BTC", "USDT", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
  /** On-chain transaction hash of the deposit (for the audit trail + receipt). */
  txHash: z.string().trim().min(8).max(120),
  note: z.string().trim().max(200).optional(),
});

/**
 * Admin: credit a user's crypto balance for a deposit received in the manual
 * business wallet. Idempotent per (asset, txHash) so the same on-chain deposit
 * can never be credited twice, even across admins.
 *
 * This is an admin ASSERTING that money arrived, so it is guarded like one: a
 * named admin, a fresh authenticator code, an ACTIVE account, a hash that is at
 * least shaped like a real transaction on that chain (22 Sep used the made-up
 * "ptprobed0f5ac83"), and the same 24-hour admin credit cap as Adjust Balance.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const body = creditSchema.parse(await req.json());
    await requireAdminOtp(req);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new ApiError(404, `No user with email ${body.email}`, "user_not_found");
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ApiError(422, `This account is ${user.status.toLowerCase()} — it can't be credited.`, "account_not_active");
    }

    const asset = body.asset as Asset;
    const wallets = await getManualWallets();
    const entry = wallets[body.asset as ManualAsset];
    if (!(MANUAL_ASSETS as readonly Asset[]).includes(asset) || !entry) {
      throw new ApiError(
        422,
        `${body.asset} is not configured as a manual wallet yet`,
        "asset_not_configured"
      );
    }

    if (!isPlausibleTxHash(entry.network, body.txHash)) {
      throw new ApiError(
        422,
        `That isn't a valid ${entry.network} transaction hash. Copy it from the block explorer.`,
        "bad_tx_hash",
      );
    }

    const amountMinor = toMinorUnits(body.amount, asset);
    const headroom = await adminCreditHeadroom(asset);
    if (amountMinor > headroom.remainingMinor) {
      throw new ApiError(
        422,
        `That's over the 24-hour admin credit limit for ${asset} (remaining ${fromMinorUnits(headroom.remainingMinor, asset)}). ` +
          "Raise ADMIN_CREDIT_DAILY_LIMITS in the deployment if this volume is expected.",
        "admin_credit_cap",
      );
    }

    const result = await creditBalance({
      userId: user.id,
      asset,
      amountMinor,
      type: TransactionType.DEPOSIT,
      idempotencyKey: `manual-deposit:${asset}:${body.txHash}`,
      network: entry.network as Network,
      txHash: body.txHash,
      metadata: { source: "manual_admin_credit", note: body.note ?? null },
    });

    await recordAdminAction(req, actor, {
      action: "admin.crypto_deposit.credited",
      summary: `Credited ${fromMinorUnits(amountMinor, asset)} ${asset} deposit to ${user.email}${result.created ? "" : " (duplicate, no change)"}`,
      userId: user.id,
      resourceType: "Transaction",
      resourceId: result.transactionId,
      details: {
        asset,
        amountMinor: amountMinor.toString(),
        txHash: body.txHash,
        duplicate: !result.created,
      },
    });

    if (result.created) {
      await notifyUser(user.id, {
        category: "deposits",
        title: "Deposit received",
        body: `${fromMinorUnits(amountMinor, asset)} ${asset} has landed in your CheqPay wallet.`,
        data: { transactionId: result.transactionId },
      });
    }

    return jsonOk({
      transactionId: result.transactionId,
      credited: result.created,
      duplicate: !result.created,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
