import { Asset, Network, TransactionType, prisma } from "@cheqpay/db";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { creditBalance } from "@/lib/ledger";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { getManualWallets, MANUAL_ASSETS, type ManualAsset } from "@/lib/manualCrypto";
import { sendPush } from "@/lib/push";

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
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = creditSchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new ApiError(404, `No user with email ${body.email}`, "user_not_found");
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

    const amountMinor = toMinorUnits(body.amount, asset);
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

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "admin.crypto_deposit.credited",
        resourceType: "Transaction",
        resourceId: result.transactionId,
        details: {
          asset,
          amountMinor: amountMinor.toString(),
          txHash: body.txHash,
          duplicate: !result.created,
        },
      },
    });

    if (result.created) {
      await sendPush(user.id, {
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
