import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getManualWallets, MANUAL_ASSETS } from "@/lib/manualCrypto";
import { getFeatureFlags } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * The crypto deposit addresses users can fund (manual custody mode). An asset
 * appears here only once the admin has configured its wallet address; the apps
 * treat everything else as "Coming soon".
 */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    // Kill switch: with crypto deposits off, every asset reads as
    // "Coming soon" in the apps (empty list) rather than erroring.
    const flags = await getFeatureFlags();
    if (!flags.crypto_deposits) {
      return jsonOk({ addresses: [] });
    }
    const wallets = await getManualWallets();
    const addresses = MANUAL_ASSETS.filter((a) => wallets[a]).map((a) => ({
      asset: a,
      address: wallets[a]!.address,
      network: wallets[a]!.network,
      networkLabel: wallets[a]!.networkLabel,
    }));
    return jsonOk({ addresses });
  } catch (err) {
    return toErrorResponse(err);
  }
}
