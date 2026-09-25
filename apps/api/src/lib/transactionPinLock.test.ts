import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Parallel PIN guessing. Every check runs holding a row lock on the user, so a
 * burst of wrong guesses is counted one by one and the lockout lands after the
 * fifth — not after "one" failure that a hundred parallel guesses shared.
 *
 * The mock stands in for Postgres's row lock with a promise chain: each
 * $transaction waits for the previous one on the same user to finish.
 */

const { state, userApi, chainRef } = vi.hoisted(() => {
  const state = {
    hash: "",
    failures: 0,
    lockedUntil: null as Date | null,
  };
  const chainRef = { p: Promise.resolve() as Promise<unknown> };
  const userApi = {
    findUnique: async () => ({
      transactionPinHash: state.hash,
      transactionPinFailures: state.failures,
      transactionPinLockedUntil: state.lockedUntil,
    }),
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if ("transactionPinFailures" in data) state.failures = data.transactionPinFailures as number;
      if ("transactionPinLockedUntil" in data) state.lockedUntil = data.transactionPinLockedUntil as Date | null;
      return {};
    },
  };
  return { state, userApi, chainRef };
});

vi.mock("@cheqpay/db", () => ({
  prisma: {
    user: userApi,
    platformSetting: { findUnique: async () => null },
    $transaction: (fn: (db: unknown) => Promise<unknown>) => {
      const run = chainRef.p.then(() => fn({ user: userApi, $queryRaw: async () => [] }));
      chainRef.p = run.catch(() => undefined);
      return run;
    },
  },
}));
vi.mock("./ensureTransactionPin", () => ({ ensureTransactionPinColumns: vi.fn().mockResolvedValue(undefined) }));

import { hashPin, requireTransactionPin } from "./transactionPin";

beforeEach(async () => {
  state.hash = await hashPin("739184");
  state.failures = 0;
  state.lockedUntil = null;
  chainRef.p = Promise.resolve();
});

describe("PIN checks under a parallel burst", () => {
  it("counts every wrong guess and locks after five, even when sent all at once", async () => {
    const guesses = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    const results = await Promise.allSettled(guesses.map((g) => requireTransactionPin("u1", g)));
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code: string }).code : "ok"));

    expect(codes.filter((c) => c === "pin_incorrect")).toHaveLength(4);
    expect(codes.filter((c) => c === "pin_locked")).toHaveLength(16);
    expect(state.failures).toBe(5);
    expect(state.lockedUntil).not.toBeNull();
  });

  it("refuses even the right PIN while locked", async () => {
    state.lockedUntil = new Date(Date.now() + 60_000);
    await expect(requireTransactionPin("u1", "739184")).rejects.toMatchObject({ code: "pin_locked" });
  });

  it("accepts the right PIN and clears the failure count", async () => {
    state.failures = 3;
    await expect(requireTransactionPin("u1", "739184")).resolves.toBeUndefined();
    expect(state.failures).toBe(0);
  });
});
