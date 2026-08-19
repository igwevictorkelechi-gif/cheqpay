import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route where a person moves money must record the initiating IP.
 *
 * Nothing else can answer "which address made this payment". `user.lastIp` is
 * only ever the most recent request of any kind and is overwritten on the next
 * call, and `AuditLog.ipAddress` sat unused for the whole life of the codebase —
 * 31 audit writes, none of them setting it — so the admin user page had no
 * honest answer to give. The IP is now written into the transaction's metadata
 * at the moment the request is handled.
 *
 * This is a static check rather than a runtime one, for the same reason as
 * schemaBootstrap.test.ts: the cost of the mistake is silent and only shows up
 * during an investigation, months later, when the data that would have answered
 * the question was never captured. Mocking four routes' worth of ledger
 * machinery to assert one field would test the mocks more than the code.
 *
 * Deliberately NOT covered: lib/ledger.ts, lib/cashback.ts and lib/swap.ts.
 * Those write derived or internal credits with no originating request, and
 * inventing an IP for them would be worse than leaving it absent.
 */

const API_SRC = join(__dirname, "..");

/** The routes where a human initiates a money movement. */
const MONEY_ROUTES = [
  "app/api/transfers/route.ts",
  "app/api/withdrawals/ngn/route.ts",
  "app/api/withdrawals/crypto/route.ts",
  "app/api/bills/pay/route.ts",
];

function read(rel: string): string {
  return readFileSync(join(API_SRC, rel), "utf8");
}

/** Strip comments so a mention in prose cannot satisfy the assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("initiating IP is recorded on user-initiated money movements", () => {
  it.each(MONEY_ROUTES)("%s resolves the caller's IP", (rel) => {
    const src = code(read(rel));
    expect(src).toContain("requestContext(req)");
  });

  it.each(MONEY_ROUTES)("%s writes that IP into transaction metadata", (rel) => {
    const src = code(read(rel));
    // The metadata object must carry the resolved IP, not merely compute it.
    expect(src).toMatch(/ip:\s*initiatorIp/);
  });

  it.each(MONEY_ROUTES)("%s stamps its audit rows with the IP", (rel) => {
    const src = code(read(rel));
    const auditWrites = (src.match(/auditLog\.create/g) ?? []).length;
    const stamped = (src.match(/ipAddress:\s*initiatorIp/g) ?? []).length;
    // Every audit row this route writes should carry the address, so the trail
    // stops being blank for exactly the actions that matter most.
    expect(stamped).toBe(auditWrites);
  });
});
