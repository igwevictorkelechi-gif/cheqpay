import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Ajo money engine against an in-memory stand-in for the database: who is
 * debited, who is credited, what is recorded as missed, and what the lien
 * sweeps. SQL is matched by the table it touches.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = {
    balances: new Map<string, bigint>(),
    txs: [] as Row[],
    exec: [] as { sql: string; values: unknown[] }[],
    query: (_sql: string, _values: unknown[]): Row[] => [],
    owed: 0n,
  };
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(state.query(strings.join("?"), values)),
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.exec.push({ sql: strings.join("?"), values });
      return Promise.resolve(1);
    },
    balance: {
      updateMany: async ({ where, data }: { where: { userId: string; available: { gte: bigint } }; data: { available: { decrement: bigint } } }) => {
        const have = state.balances.get(where.userId) ?? 0n;
        if (have < where.available.gte) return { count: 0 };
        state.balances.set(where.userId, have - data.available.decrement);
        return { count: 1 };
      },
      upsert: async ({ where, update }: { where: { userId_asset: { userId: string } }; update: { available: { increment: bigint } } }) => {
        const u = where.userId_asset.userId;
        state.balances.set(u, (state.balances.get(u) ?? 0n) + update.available.increment);
        return {};
      },
      findUnique: async ({ where }: { where: { userId_asset: { userId: string } } }) => ({
        available: state.balances.get(where.userId_asset.userId) ?? 0n,
      }),
    },
    transaction: { create: async ({ data }: { data: Row }) => (state.txs.push(data), data) },
    user: { findUnique: async () => ({ kycTier: 2, status: "ACTIVE" }) },
  };
  return { state, db };
});

vi.mock("@cheqpay/db", () => ({
  prisma: { ...h.db, $transaction: (fn: (db: unknown) => unknown) => fn(h.db) },
  Asset: { NGN: "NGN" },
  TransactionStatus: { COMPLETED: "COMPLETED" },
  TransactionType: { AJO_SAVE: "AJO_SAVE", AJO_RELEASE: "AJO_RELEASE", AJO_CONTRIBUTION: "AJO_CONTRIBUTION", AJO_PAYOUT: "AJO_PAYOUT" },
}));
vi.mock("./schema", () => ({ ensureAjoSchema: async () => undefined }));
vi.mock("./lien", () => ({
  ajoArrearsKobo: async () => h.state.owed,
  assertNoAjoArrears: async () => {
    if (h.state.owed > 0n) throw Object.assign(new Error("owes"), { status: 423, code: "ajo_arrears" });
  },
}));
vi.mock("@/lib/kyc", () => ({ getTierLimits: () => ({ singleTxKobo: 100_000_000n }) }));
vi.mock("@/lib/settings", () => ({ getAjoBreakFeeBps: async () => 100 }));
vi.mock("@/lib/alerts", () => ({ notifyUser: vi.fn(async () => ({})) }));
vi.mock("@/lib/limits", () => ({ lockUserMoney: vi.fn(async () => undefined) }));

import { breakPlan, createPlan, runDuePlans } from "./personal";
import { runDueRounds, sweepArrears } from "./groups";

const AMT = 1_000_000n; // ₦10,000
const bal = (u: string) => h.state.balances.get(u) ?? 0n;
const execs = (table: string) => h.state.exec.filter((e) => e.sql.includes(table));
const far = () => Date.now() + 10_000;

beforeEach(() => {
  h.state.balances = new Map();
  h.state.txs = [];
  h.state.exec = [];
  h.state.owed = 0n;
  h.state.query = () => [];
});

function plan(over: Row = {}): Row {
  return {
    id: "p1", user_id: "u1", name: "Rent", amount_minor: AMT, frequency: "weekly", total_count: 3,
    paid_count: 1, missed_count: 0, saved_minor: AMT, status: "active",
    next_due_at: new Date("2026-03-10T08:00:00Z"), ...over,
  };
}

describe("personal Ajo", () => {
  it("takes the first contribution when the plan is created", async () => {
    h.state.balances.set("u1", 1_500_000n);
    h.state.query = (sql) => (sql.includes("INSERT INTO ajo_plans") ? [plan()] : []);
    await createPlan("u1", { name: "Rent", amountKobo: AMT, frequency: "weekly", count: 3 });
    expect(bal("u1")).toBe(500_000n);
    expect(h.state.txs).toEqual([expect.objectContaining({ type: "AJO_SAVE", amount: AMT, idempotencyKey: "ajo:p:p1:1" })]);
  });

  it("refuses to create a plan the wallet can't fund", async () => {
    h.state.balances.set("u1", 10n);
    h.state.query = (sql) => (sql.includes("INSERT INTO ajo_plans") ? [plan()] : []);
    await expect(createPlan("u1", { name: "Rent", amountKobo: AMT, frequency: "weekly", count: 3 })).rejects.toMatchObject({
      code: "insufficient_funds",
    });
    expect(h.state.txs).toEqual([]);
  });

  it("refuses a new plan while the user owes an Ajo group", async () => {
    h.state.owed = 1n;
    await expect(createPlan("u1", { name: "Rent", amountKobo: AMT, frequency: "weekly", count: 3 })).rejects.toMatchObject({
      code: "ajo_arrears",
    });
  });

  it("debits a due contribution and moves the due date on", async () => {
    h.state.balances.set("u1", AMT);
    let served = false;
    h.state.query = (sql) => (sql.includes("FOR UPDATE SKIP LOCKED") && !served ? ((served = true), [plan()]) : []);
    const out = await runDuePlans({ deadline: far() });
    expect(out).toEqual({ processed: 1, missed: 0, matured: 0 });
    expect(bal("u1")).toBe(0n);
    const upd = execs("UPDATE ajo_plans")[0];
    expect(upd.values[0]).toBe(2n * AMT); // saved
    expect(upd.values).toContainEqual(new Date("2026-03-17T08:00:00Z"));
  });

  it("records a miss when the wallet is short, and when the user owes a group", async () => {
    for (const setup of [() => h.state.balances.set("u1", 5n), () => { h.state.balances.set("u1", AMT); h.state.owed = 1n; }]) {
      h.state.exec = [];
      setup();
      let served = false;
      h.state.query = (sql) => (sql.includes("FOR UPDATE SKIP LOCKED") && !served ? ((served = true), [plan()]) : []);
      const out = await runDuePlans({ deadline: far() });
      expect(out.missed).toBe(1);
      expect(h.state.txs).toEqual([]);
    }
  });

  it("returns everything saved, free, on the last contribution", async () => {
    h.state.balances.set("u1", AMT);
    let served = false;
    h.state.query = (sql) =>
      sql.includes("FOR UPDATE SKIP LOCKED") && !served ? ((served = true), [plan({ paid_count: 2, saved_minor: 2n * AMT })]) : [];
    const out = await runDuePlans({ deadline: far() });
    expect(out.matured).toBe(1);
    expect(bal("u1")).toBe(3n * AMT);
    expect(h.state.txs.at(-1)).toMatchObject({ type: "AJO_RELEASE", amount: 3n * AMT, fee: 0n, idempotencyKey: "ajo:p:p1:release" });
    expect(execs("status = 'matured'")).toHaveLength(1);
  });

  it("keeps the break fee when a plan is broken early", async () => {
    h.state.query = (sql) => (sql.includes("FROM ajo_plans") ? [plan({ saved_minor: 2n * AMT })] : []);
    const r = await breakPlan("u1", "p1");
    expect(r).toEqual({ returnedKobo: 1_980_000n, feeKobo: 20_000n }); // 1% of ₦20,000
    expect(bal("u1")).toBe(1_980_000n);
    expect(h.state.txs[0]).toMatchObject({ type: "AJO_RELEASE", amount: 2n * AMT, fee: 20_000n });
  });

  it("won't break a plan that has already ended", async () => {
    h.state.query = (sql) => (sql.includes("FROM ajo_plans") ? [plan({ status: "matured" })] : []);
    await expect(breakPlan("u1", "p1")).rejects.toMatchObject({ code: "ajo_closed" });
  });
});

describe("group Ajo rounds", () => {
  const group = {
    id: "g1", owner_id: "u1", name: "Office", amount_minor: AMT, frequency: "monthly", size: 3,
    current_round: 1, status: "active", next_due_at: new Date("2026-03-01T08:00:00Z"),
  };
  const members = [
    { user_id: "u1", position: 1 },
    { user_id: "u2", position: 2 },
    { user_id: "u3", position: 3 },
  ];

  function serveRound(g: Row = group) {
    let served = false;
    h.state.query = (sql) => {
      if (sql.includes("FROM ajo_groups") && sql.includes("SKIP LOCKED")) return served ? [] : ((served = true), [g]);
      if (sql.includes("FROM ajo_members")) return members;
      return [];
    };
  }

  it("debits every member but the collector and pays the collector at once", async () => {
    h.state.balances.set("u1", 0n);
    h.state.balances.set("u2", AMT);
    h.state.balances.set("u3", AMT);
    serveRound();
    const out = await runDueRounds({ deadline: far() });
    expect(out).toEqual({ rounds: 1, missed: 0 });
    expect(bal("u2")).toBe(0n);
    expect(bal("u3")).toBe(0n);
    expect(bal("u1")).toBe(2n * AMT); // the other two shares; their own never left
    expect(h.state.txs.find((t) => t.type === "AJO_PAYOUT")).toMatchObject({ userId: "u1", amount: 2n * AMT, idempotencyKey: "ajo:gp:g1:1" });
    expect(h.state.txs.filter((t) => t.type === "AJO_CONTRIBUTION").map((t) => t.idempotencyKey)).toEqual([
      "ajo:g:g1:1:u2",
      "ajo:g:g1:1:u3",
    ]);
    const next = execs("SET current_round")[0];
    expect(next.values[0]).toBe(2);
  });

  it("puts a short member in arrears and CheqPay pays nothing in their place", async () => {
    h.state.balances.set("u2", AMT);
    h.state.balances.set("u3", 5n);
    serveRound();
    const out = await runDueRounds({ deadline: far() });
    expect(out.missed).toBe(1);
    expect(bal("u1")).toBe(AMT); // only u2's share
    expect(bal("u3")).toBe(5n);
    const missed = execs("INSERT INTO ajo_contributions").find((e) => e.sql.includes("'missed'"));
    expect(missed?.values).toContain("u3");
  });

  it("closes the group after the last round", async () => {
    h.state.balances.set("u1", AMT);
    h.state.balances.set("u2", AMT);
    serveRound({ ...group, current_round: 3 });
    await runDueRounds({ deadline: far() });
    expect(bal("u3")).toBe(2n * AMT);
    expect(execs("status = 'completed'")).toHaveLength(1);
  });
});

describe("arrears sweep (the lien)", () => {
  it("pays what came in to the collectors owed, oldest first, part payments allowed", async () => {
    h.state.balances.set("u3", 1_500_000n);
    const owed = [
      { id: "c1", group_id: "g1", round: 1, recipient_id: "u1", amount_minor: AMT, paid_minor: 0n, name: "Office" },
      { id: "c2", group_id: "g1", round: 2, recipient_id: "u2", amount_minor: AMT, paid_minor: 0n, name: "Office" },
    ];
    h.state.query = (sql) => {
      if (sql.includes("SELECT DISTINCT c.user_id")) return [{ user_id: "u3" }];
      if (sql.includes("FOR UPDATE OF c")) return owed;
      return [];
    };
    const out = await sweepArrears({ deadline: far() });
    expect(out).toEqual({ users: 1, settledKobo: 1_500_000n });
    expect(bal("u3")).toBe(0n);
    expect(bal("u1")).toBe(AMT);
    expect(bal("u2")).toBe(500_000n);
    const statuses = execs("UPDATE ajo_contributions").map((e) => e.values[1]);
    expect(statuses).toEqual(["paid", "partial"]);
    expect(h.state.txs.map((t) => t.idempotencyKey)).toEqual(["ajo:gl:c1:0", "ajo:glp:c1:0", "ajo:gl:c2:0", "ajo:glp:c2:0"]);
  });
});
