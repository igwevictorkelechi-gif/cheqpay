import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {}, Asset: { NGN: "NGN" } }));

import { ajoArrearsKobo, assertNoAjoArrears } from "./lien";

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

  it("refuses money out with 423 ajo_arrears while anything is owed", async () => {
    await expect(assertNoAjoArrears("u1", db(async () => [{ owed: 500_000n }]))).rejects.toMatchObject({
      status: 423,
      code: "ajo_arrears",
      message: expect.stringContaining("₦5,000"),
    });
    await expect(assertNoAjoArrears("u1", db(async () => [{ owed: 0n }]))).resolves.toBeUndefined();
  });
});
