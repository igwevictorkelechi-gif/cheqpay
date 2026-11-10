import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {}, Asset: { NGN: "NGN" } }));

import { ajoArrearsKobo, ajoCommitments, ajoPotsKobo, assertNoAjoArrears } from "./lien";

const db = (impl: () => Promise<unknown>) => ({ $queryRaw: vi.fn(impl) }) as never;

describe("Ajo lien", () => {
  it("sums what a member still owes", async () => {
    expect(await ajoArrearsKobo("u1", db(async () => [{ owed: 150_000n }]))).toBe(150_000n);
  });

  it("owes nothing before the Ajo tables exist", async () => {
    const missing = Object.assign(new Error('relation "ajo_contributions" does not exist'), { code: "42P01" });
    expect(await ajoArrearsKobo("u1", db(async () => Promise.reject(missing)))).toBe(0n);
  });

  it("fails closed on any other database error", async () => {
    await expect(ajoArrearsKobo("u1", db(async () => Promise.reject(new Error("timeout"))))).rejects.toThrow("timeout");
  });

  it("reports what Ajo holds for a user, so an account can't close around it", async () => {
    const q = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM ajo_plans")) return [{ n: 2, saved: 300_000n }];
      if (sql.includes("FROM ajo_members")) return [{ n: 1 }];
      return [{ owed: 0n }];
    });
    expect(await ajoCommitments("u1", { $queryRaw: q } as never)).toEqual({
      savedKobo: 300_000n,
      activePlans: 2,
      openGroups: 1,
      owedKobo: 0n,
    });
    const missing = Object.assign(new Error('relation "ajo_plans" does not exist'), { code: "42P01" });
    expect(await ajoCommitments("u1", db(async () => Promise.reject(missing)))).toEqual({
      savedKobo: 0n,
      activePlans: 0,
      openGroups: 0,
      owedKobo: 0n,
    });
  });

  it("totals the naira in active plans for the treasury check", async () => {
    expect(await ajoPotsKobo(db(async () => [{ saved: 1_234n }]))).toBe(1_234n);
    const missing = Object.assign(new Error('relation "ajo_plans" does not exist'), { code: "42P01" });
    expect(await ajoPotsKobo(db(async () => Promise.reject(missing)))).toBe(0n);
  });

  it("refuses money out with 423 ajo_arrears while anything is owed", async () => {
    await expect(assertNoAjoArrears("u1", db(async () => [{ owed: 500_000n }]))).rejects.toMatchObject({
      status: 423,
      code: "ajo_arrears",
      message: expect.stringContaining("₦5,000"),
    });
    await expect(assertNoAjoArrears("u1", db(async () => [{ owed: 0n }]))).resolves.toBeUndefined();
  });
});
