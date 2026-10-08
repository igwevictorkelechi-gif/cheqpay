// apps/api/src/lib/devapi/cron.ts
//
// The developer platform's daily job: renew plans, prove every wallet balance
// against its ledger (freezing any that don't add up), catch deposits whose
// webhook never came, retry verifications and webhook deliveries, erase old
// sandbox personal data, and prune old logs and events.

import { alertOpsOnce } from "../opsAlert";
import { renewDueSubscriptions } from "./billing";
import { findLedgerMismatches, freezeMismatchedWallets } from "./ledger";
import { pruneDevLogs } from "./logs";
import { ensureDevApiSchema } from "./ensureDevApi";
import { reconcileLiveDeposits } from "./deposits";
import { retryDueVerifications, scrubOldSandboxData } from "./customers";
import { sweepDueDeliveries } from "./webhooks";
import { pruneEvents } from "./events";

export async function runDevelopersDaily(now: Date = new Date()) {
  await ensureDevApiSchema();
  const renewals = await renewDueSubscriptions(now);

  const mismatches = await findLedgerMismatches();
  const frozen = await freezeMismatchedWallets(mismatches);
  if (mismatches.length > 0) {
    await alertOpsOnce(
      "devapi-reconciliation",
      `🚨 Developer ledger: ${mismatches.length} wallet balance(s) don't match their entries; ${frozen} newly frozen. Investigate before unfreezing.`,
      Object.fromEntries(mismatches.slice(0, 10).map((m) => [m.wallet_id, `balance ${m.available_minor} vs entries ${m.ledger_sum}`])),
    );
  }

  // Each step is independent: one failing must not stop the rest.
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[devapi cron] ${name} failed`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const deposits = await step("deposit reconciliation", () => reconcileLiveDeposits(50));
  const verifications = await step("verification retries", () => retryDueVerifications(100));
  const webhooks = await step("webhook retries", () => sweepDueDeliveries({ limit: 2_000, budgetMs: 120_000 }));
  const scrubbed = await step("sandbox scrub", () => scrubOldSandboxData());
  const events = await step("event pruning", () => pruneEvents());
  const pruned = await pruneDevLogs();
  return {
    renewals,
    reconciliation: { mismatches: mismatches.length, frozen },
    deposits,
    verifications,
    webhooks,
    scrubbed,
    pruned: { ...pruned, events },
  };
}
