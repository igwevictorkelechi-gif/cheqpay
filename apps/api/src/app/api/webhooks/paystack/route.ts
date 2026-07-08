import { paystackIfConfigured } from "@/payments";
import { handleNgnWebhook } from "@/lib/ngnWebhook";
import { jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook (dedicated-account deposits + transfer results).
 * Signature: HMAC-SHA512 of the raw body with the secret key, sent in the
 * x-paystack-signature header. Register this URL in the Paystack dashboard:
 *   <API_PUBLIC_URL>/api/webhooks/paystack
 */
export async function POST(req: Request) {
  const provider = paystackIfConfigured();
  if (!provider) {
    return jsonOk({ error: "Paystack is not configured", code: "not_configured" }, 503);
  }
  return handleNgnWebhook(provider, req, ["x-paystack-signature"]);
}
