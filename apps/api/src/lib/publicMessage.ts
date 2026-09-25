// apps/api/src/lib/publicMessage.ts
//
// CheqPay doesn't publish which companies it works with. Provider text that
// can reach a user — a declined bill, a verification result — goes through
// here, so a provider's own name never appears on a customer's screen. The
// full text still goes to the logs and the audit trail for the team.

const PROVIDER_NAMES =
  /\b(maplerad|supabase|vercel|tatum|binance|dojah|flutterwave|paystack|sentry|resend)\b/gi;

/** The same text with any provider name replaced by a neutral phrase. */
export function scrubProviderNames(text: string): string {
  return text
    .replace(new RegExp(`\\s*(via|through|by|from|at|with)\\s+${PROVIDER_NAMES.source}`, "gi"), "")
    .replace(PROVIDER_NAMES, "our provider")
    .trim();
}
