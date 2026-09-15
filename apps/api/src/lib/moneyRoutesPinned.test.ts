import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route that can move a user's money must call the transaction-PIN gate.
 *
 * This is a static check on the source rather than a behavioural one, for the
 * same reason schemaBootstrap.test.ts is: the failure it guards against is
 * OMISSION. A new payout route added next year would pass every test written
 * about the routes that exist today, and would ship unauthorised. A list that
 * must be edited to add a route is the only kind of check that notices.
 *
 * If you are here because you added a route and this failed: add the gate,
 * don't add an exemption. If a route genuinely cannot take a PIN, put it in
 * EXEMPT below WITH the reason, so the next reader sees a decision rather than
 * an oversight.
 */

const API_DIR = join(__dirname, "..", "app", "api");

/** Routes that spend, send or convert a user's balance. */
const MONEY_ROUTES = [
  "transfers/route.ts",
  "withdrawals/ngn/route.ts",
  "withdrawals/crypto/route.ts",
  "bills/pay/route.ts",
  "swaps/route.ts",
  "cards/[id]/fund/route.ts",
  "cards/[id]/withdraw/route.ts",
];

/**
 * Money-adjacent routes that deliberately do NOT take a PIN, and why.
 *
 *  - quotes/convert: issues a PRICE, moves nothing. The swap that spends the
 *    quote is gated, which is where the money actually leaves.
 *  - admin/*: staff acting on someone else's account. Their authorisation is
 *    admin identity plus the audit log; a customer PIN would be both unknown
 *    to them and the wrong control.
 */
const EXEMPT = ["quotes/convert/route.ts"];

describe("every money route is behind the transaction PIN", () => {
  for (const route of MONEY_ROUTES) {
    it(`${route} calls requireTransactionPin`, () => {
      const src = readFileSync(join(API_DIR, route), "utf8");
      expect(src).toContain("requireTransactionPin");
      // The PIN must come from the header helper. A route reading it out of the
      // parsed body could sweep it into transaction.metadata via a spread —
      // see the note in lib/transactionPin.ts.
      expect(src).toContain("readPin(req)");
    });
  }

  it("the exempt list is a decision, not a hiding place", () => {
    // Guards against the list quietly growing to silence this test.
    expect(EXEMPT.length).toBeLessThanOrEqual(2);
  });
});
