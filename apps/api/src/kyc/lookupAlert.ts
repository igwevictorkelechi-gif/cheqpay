// apps/api/src/kyc/lookupAlert.ts
//
// Tell ops the same day when the BVN lookup itself is broken. A lookup the
// provider refuses ("insufficient balance", "Unauthorized", an IP block) or
// cannot be reached for does not reject the customer — their submission falls
// through to manual review — so nothing on the customer's side looks wrong and
// the failure used to go unnoticed for days. That is an ops problem (fund the
// wallet, fix the key, fix the egress proxy), not a customer problem, so it
// goes to the ops webhook.
//
// A BVN the registry simply does not know is the customer's problem and does
// not alert.

import { MapleradError } from "@/lib/maplerad/client";
import { notifyAdminAlert } from "@/lib/adminAlert";

export type LookupOutage = "balance" | "auth" | "unreachable" | "provider_error";

/** Why the lookup could not run, or null when the failure is about the BVN itself. */
export function classifyLookupFailure(err: unknown): LookupOutage | null {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err instanceof MapleradError ? err.status : 0;
  if (/insufficient|balance/i.test(msg) || status === 402) return "balance";
  if (/unauthori[sz]ed|forbidden|access denied|not configured|invalid (api )?key/i.test(msg) || status === 401 || status === 403) {
    return "auth";
  }
  if (!(err instanceof MapleradError) || status === 0 || /fetch failed|timed? ?out|ECONN|ENOTFOUND|network/i.test(msg)) {
    return "unreachable";
  }
  if (status >= 500) return "provider_error";
  return null;
}

const HINT: Record<LookupOutage, string> = {
  balance: "Maplerad says the account can't pay for lookups — top up the wallet Maplerad charges for identity checks.",
  auth: "Maplerad refused our credentials — check MAPLERAD_SECRET_KEY and the IP whitelist / egress proxy.",
  unreachable: "Maplerad could not be reached — check MAPLERAD_BASE_URL and the egress proxy.",
  provider_error: "Maplerad returned a server error — check their status and retry an admin lookup.",
};

/** Once an hour per kind, per server instance — one alert per incident, not per customer. */
const THROTTLE_MS = 60 * 60 * 1000;
const lastAlertAt = new Map<LookupOutage, number>();

export function resetLookupAlertThrottle(): void {
  lastAlertAt.clear();
}

/** Alert ops if this failure means lookups are broken. Never throws. */
export async function alertLookupFailure(err: unknown, now: number = Date.now()): Promise<boolean> {
  const kind = classifyLookupFailure(err);
  if (!kind) return false;
  const last = lastAlertAt.get(kind);
  if (last !== undefined && now - last < THROTTLE_MS) return false;
  lastAlertAt.set(kind, now);
  const reason = err instanceof Error ? err.message : String(err);
  await notifyAdminAlert(
    `⚠️ BVN verification is failing (${kind}). Customers' KYC is going to manual review. ${HINT[kind]}`,
    { kind, reason: reason.slice(0, 300) }
  ).catch(() => undefined);
  return true;
}
