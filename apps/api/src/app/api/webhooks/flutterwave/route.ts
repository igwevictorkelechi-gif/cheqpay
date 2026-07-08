import { flutterwaveIfConfigured, getPaymentProvider } from "@/payments";
import { handleNgnWebhook } from "@/lib/ngnWebhook";

export const dynamic = "force-dynamic";

/**
 * Flutterwave webhook (deposit charges + payout results). Uses the
 * Flutterwave provider when its keys are configured — even if the main rail
 * is Paystack — so bills/legacy events keep verifying; otherwise the active
 * provider (mock in dev).
 */
export async function POST(req: Request) {
  const provider = flutterwaveIfConfigured() ?? getPaymentProvider();
  return handleNgnWebhook(provider, req, ["verif-hash", "x-signature"]);
}
