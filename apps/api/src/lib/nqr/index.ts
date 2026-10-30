import type { NqrProvider } from "./types";
import { MockNqrProvider } from "./mock";

export type { NqrProvider, NqrMerchant, NqrPayloadInput } from "./types";
export { emvCrc16 } from "./mock";

/**
 * The active NQR provider.
 *
 * Only the mock exists today — there is no live NQR integration — so this
 * always returns a provider whose `live` flag is false. When CheqPay onboards
 * with a NIBSS NQR aggregator, add that adapter here (selected by env, as the
 * custody/payment providers are) and the `nqr_payments` feature flag becomes
 * meaningful. Until then, callers should treat `live === false` as "cross-bank
 * QR is not available" regardless of the flag.
 */
export function getNqrProvider(): NqrProvider {
  return new MockNqrProvider();
}
