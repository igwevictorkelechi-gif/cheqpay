import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Admin: provider configuration status. Returns provider modes and whether the
 * required keys are present in the environment. Never returns secret values —
 * only booleans, so the admin can see what still needs wiring for go-live.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const has = (key: string): boolean => {
      const v = process.env[key];
      return typeof v === "string" && v.trim().length > 0;
    };

    return jsonOk({
      custody: {
        provider: process.env.CUSTODY_PROVIDER ?? "mock",
        apiKeyConfigured: has("TATUM_API_KEY"),
        webhookConfigured: has("TATUM_WEBHOOK_SECRET"),
      },
      payments: {
        provider: process.env.PAYMENT_PROVIDER ?? "mock",
        secretKeyConfigured: has("FLUTTERWAVE_SECRET_KEY"),
        webhookConfigured: has("FLUTTERWAVE_WEBHOOK_HASH"),
      },
      priceFeed: process.env.PRICE_FEED ?? "mock",
      relaxWithdrawalGuards:
        (process.env.RELAX_WITHDRAWAL_GUARDS ?? "").toLowerCase() === "true",
      adminSecretConfigured: has("ADMIN_API_SECRET"),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
