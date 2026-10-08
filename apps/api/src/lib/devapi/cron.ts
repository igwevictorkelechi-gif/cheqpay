// apps/api/src/lib/devapi/cron.ts
//
// The developer platform's daily job: renew plans, prove every wallet balance
// against its ledger (freezing any that don't add up), and prune old logs.

import { alertOpsOnce } from "../opsAlert";
import { renewDueSubscriptions } from "./billing";
import { findLedgerMismatches, freezeMismatchedWallets } from "./ledger";
import { pruneDevLogs } from "./logs";
import { ensureDevApiSchema } from "./ensureDevApi";

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

  const pruned = await pruneDevLogs();
  return {
    renewals,
    reconciliation: { mismatches: mismatches.length, frozen },
    pruned,
  };
}
