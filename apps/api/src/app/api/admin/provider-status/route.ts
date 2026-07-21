import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Admin: provider configuration status. Returns provider modes and whether the
 * required keys are present in the environment. Never returns secret values —
 * only booleans and PARSED enum values. (Raw process.env provider modes are
 * never echoed: if a secret is ever pasted into one by mistake, the zod
 * fallback normalizes it instead of displaying it in the dashboard.)
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const env = getEnv();

    const has = (key: string): boolean => {
      const v = process.env[key];
      return typeof v === "string" && v.trim().length > 0;
    };

    const custodyCryptoApis = env.CUSTODY_PROVIDER === "cryptoapis";
    return jsonOk({
      custody: {
        provider: env.CUSTODY_PROVIDER,
        apiKeyConfigured: custodyCryptoApis
          ? has("CRYPTOAPIS_API_KEY") && has("CRYPTOAPIS_WALLET_ID")
          : has("TATUM_API_KEY"),
        webhookConfigured: custodyCryptoApis
          ? has("CRYPTOAPIS_WEBHOOK_SECRET")
          : has("TATUM_WEBHOOK_SECRET"),
      },
      payments: {
        provider: env.PAYMENT_PROVIDER,
        secretKeyConfigured: has("MAPLERAD_SECRET_KEY"),
        // Maplerad signs webhooks with Svix, using a separate whsec_ secret.
        webhookConfigured: has("MAPLERAD_WEBHOOK_SECRET"),
      },
      bills: {
        // Bills run on the same rail as everything else (Maplerad).
        provider: env.PAYMENT_PROVIDER,
        configured: has("MAPLERAD_SECRET_KEY"),
      },
      // NGN deposits need Maplerad to enable collections on the business; until
      // then virtual-account creation fails and the deposit path stays dark.
      deposits: { available: false, reason: "maplerad_collections_not_enabled" },
      priceFeed: env.PRICE_FEED,
      relaxWithdrawalGuards: env.RELAX_WITHDRAWAL_GUARDS,
      adminSecretConfigured: has("ADMIN_API_SECRET"),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
