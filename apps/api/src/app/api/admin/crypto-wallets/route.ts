import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import {
  getManualWallets,
  setManualWallets,
  manualWalletsSchema,
  MANUAL_ASSETS,
  type ManualWallets,
  type ManualAsset,
} from "@/lib/manualCrypto";
import { prisma } from "@cheqpay/db";

export const dynamic = "force-dynamic";

/** Admin: read the manually-managed crypto deposit wallets. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ wallets: await getManualWallets() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: replace the manual crypto wallet set. Setting an asset's entry makes
 * it live for users immediately (Receive shows the address, Send queues for
 * manual payout); null/absent disables it back to "Coming soon".
 */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const body = manualWalletsSchema.parse(await req.json());

    const wallets: ManualWallets = {};
    for (const a of MANUAL_ASSETS) {
      const e = body[a as ManualAsset];
      if (e) wallets[a as ManualAsset] = e;
    }
    await setManualWallets(wallets, "admin");

    await prisma.auditLog.create({
      data: {
        action: "admin.crypto_wallets.updated",
        resourceType: "PlatformSetting",
        details: { assets: Object.keys(wallets) },
      },
    });

    return jsonOk({ wallets });
  } catch (err) {
    return toErrorResponse(err);
  }
}
