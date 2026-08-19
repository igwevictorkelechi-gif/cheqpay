import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { piiKeyStatus } from "@/lib/pii";

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

    return jsonOk({
      custody: {
        // Custody runs on the same Maplerad credentials as the NGN rail.
        provider: env.CUSTODY_PROVIDER,
        apiKeyConfigured: has("MAPLERAD_SECRET_KEY"),
        webhookConfigured: has("MAPLERAD_WEBHOOK_SECRET"),
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
      // NGN deposits are wired end to end (collection account at KYC approval,
      // credit on the collection webhook). Whether they actually work depends on
      // collections being enabled on the Maplerad business and this server's IP
      // being whitelisted — neither is visible from process.env, so this reports
      // configuration only. GET /api/admin/provider-check answers "does it work"
      // by making real calls.
      deposits: {
        configured: env.PAYMENT_PROVIDER === "maplerad" && has("MAPLERAD_SECRET_KEY"),
        verifyWith: "/api/admin/provider-check",
      },
      // Whether regulated personal data can actually be stored. Reported as a
      // three-way status, not a boolean, because "set but malformed" needs a
      // different fix from "not set" — and because a bad key is otherwise
      // invisible until someone submits a KYC form and reads the logs. The key
      // itself is never echoed, only the verdict.
      piiEncryption: {
        status: piiKeyStatus(),
        retainsBvn: piiKeyStatus() === "ok",
      },
      priceFeed: env.PRICE_FEED,
      relaxWithdrawalGuards: env.RELAX_WITHDRAWAL_GUARDS,
      adminSecretConfigured: has("ADMIN_API_SECRET"),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
