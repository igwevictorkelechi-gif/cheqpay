import { requireAdmin } from "@/lib/auth";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import {
  getManualWallets,
  setManualWallets,
  manualWalletsSchema,
  MANUAL_ASSETS,
  type ManualWallets,
  type ManualAsset,
} from "@/lib/manualCrypto";

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
    // These are the addresses every customer deposits to. Changing one could
    // point all incoming crypto at someone else's wallet, so: Super Admin, a
    // fresh authenticator code, and an alert showing old and new addresses.
    const actorInfo = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const before = await getManualWallets();
    const body = manualWalletsSchema.parse(await req.json());

    const wallets: ManualWallets = {};
    for (const a of MANUAL_ASSETS) {
      const e = body[a as ManualAsset];
      if (e) wallets[a as ManualAsset] = e;
    }
    await setManualWallets(wallets, actorInfo.email);

    const changes = MANUAL_ASSETS.map((a) => {
      const from = before[a as ManualAsset]?.address ?? null;
      const to = wallets[a as ManualAsset]?.address ?? null;
      return from === to ? null : { asset: a, from, to };
    }).filter(Boolean);
    await recordAdminAction(req, actorInfo, {
      action: "admin.crypto_wallets.updated",
      summary:
        changes.length === 0
          ? "Business crypto deposit addresses saved (no change)"
          : `Business crypto deposit ADDRESSES CHANGED: ${changes
              .map((c) => `${c!.asset} ${c!.from ?? "(none)"} → ${c!.to ?? "(disabled)"}`)
              .join("; ")}`,
      resourceType: "PlatformSetting",
      resourceId: "manual_crypto_wallets",
      details: { changes },
    });

    return jsonOk({ wallets });
  } catch (err) {
    return toErrorResponse(err);
  }
}
