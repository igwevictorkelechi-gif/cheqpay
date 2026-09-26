import { describe, expect, it } from "vitest";
import { assertWithdrawalAllowed, lockUserMoney } from "./limits";
import { ApiError } from "./http";

// Tier 2: single-tx 1,000,000 NGN = 100,000,000 kobo; daily withdrawal
// 2,000,000 NGN = 200,000,000 kobo.
describe("assertWithdrawalAllowed", () => {
  it("allows a withdrawal within both limits", () => {
    expect(() => assertWithdrawalAllowed(2, 50_000_000n, 0n)).not.toThrow();
  });

  it("rejects non-positive amounts", () => {
    expect(() => assertWithdrawalAllowed(2, 0n, 0n)).toThrow(ApiError);
  });

  it("rejects amounts over the per-transaction limit", () => {
    expect(() => assertWithdrawalAllowed(2, 100_000_001n, 0n)).toThrow(/per-transaction/);
  });

  it("rejects amounts over the remaining daily limit", () => {
    // already used 150,000,000 today; remaining = 50,000,000
    expect(() => assertWithdrawalAllowed(2, 60_000_000n, 150_000_000n)).toThrow(/daily/);
    expect(() => assertWithdrawalAllowed(2, 50_000_000n, 150_000_000n)).not.toThrow();
  });

  it("tier 1 cannot withdraw above its small single-tx ceiling", () => {
    // tier 1 single-tx = 50,000 NGN = 5,000,000 kobo
    expect(() => assertWithdrawalAllowed(1, 5_000_001n, 0n)).toThrow(/per-transaction/);
  });
});

describe("lockUserMoney", () => {
  it("takes the per-user lock without selecting its void result", async () => {
    // pg_advisory_xact_lock returns `void`. Selecting it directly made Prisma
    // throw "Failed to deserialize column of type 'void'", which rolled back
    // every NGN and crypto withdrawal. The lock must be wrapped so the query
    // returns an ordinary column.
    let sql = "";
    let params: unknown[] = [];
    const db = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        sql = strings.join("?").replace(/\s+/g, " ").trim();
        params = values;
        return [{ locked: 1 }];
      },
    };
    await lockUserMoney(db as never, "user-1");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext(?))");
    expect(params).toEqual(["user-1"]);
    expect(sql).not.toMatch(/^SELECT pg_advisory_xact_lock/i);
    expect(sql).toMatch(/^SELECT 1 AS locked FROM \(SELECT pg_advisory_xact_lock/i);
  });
});
