import { beforeEach, describe, expect, it, vi } from "vitest";

/** Closing an account must not strand money anywhere it could still be owed. */

const h = vi.hoisted(() => ({
  balances: [] as { available: bigint; locked: bigint }[],
  inFlight: 0,
  orders: 0,
  raw: new Map<string, number>(),
  ajo: { savedKobo: 0n, activePlans: 0, openGroups: 0, owedKobo: 0n },
}));

vi.mock("@cheqpay/db", () => ({
  TransactionStatus: { PENDING: "PENDING", PROCESSING: "PROCESSING" },
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join("?"), values }) },
  prisma: {
    balance: { findMany: async () => h.balances },
    transaction: { count: async () => h.inFlight },
    gadgetOrder: { count: async () => h.orders },
    $queryRaw: async (q: { sql: string }) => {
      const hit = [...h.raw.entries()].find(([table]) => q.sql.includes(table));
      if (!hit) throw Object.assign(new Error('relation "x" does not exist'), { code: "42P01" });
      return [{ n: hit[1] }];
    },
  },
}));
vi.mock("@/lib/ajo/lien", () => ({ ajoCommitments: async () => h.ajo }));

import { closureBlockers } from "./accountClosure";

beforeEach(() => {
  h.balances = [{ available: 0n, locked: 0n }];
  h.inFlight = 0;
  h.orders = 0;
  h.raw = new Map();
  h.ajo = { savedKobo: 0n, activePlans: 0, openGroups: 0, owedKobo: 0n };
});

describe("closureBlockers", () => {
  it("lets an empty, settled account close", async () => {
    expect(await closureBlockers("u1")).toEqual([]);
  });

  it("treats features whose tables don't exist as nothing owed", async () => {
    h.raw = new Map(); // every raw table missing
    expect(await closureBlockers("u1")).toEqual([]);
  });

  it("names each thing that would be stranded, most urgent first", async () => {
    h.ajo = { savedKobo: 0n, activePlans: 0, openGroups: 0, owedKobo: 10n };
    h.balances = [{ available: 5n, locked: 0n }];
    h.inFlight = 1;
    h.orders = 2;
    h.raw = new Map([["dev_wallets", 1], ["gift_card_trades", 1], ["ad_campaign_slots", 3]]);
    expect((await closureBlockers("u1")).map((b) => b.code)).toEqual([
      "ajo_active",
      "nonzero_balance",
      "pending_transactions",
      "developer_wallet",
      "gift_card_review",
      "open_orders",
      "live_ads",
    ]);
  });

  it("blocks on a payout still in flight even with a zero balance", async () => {
    h.inFlight = 1;
    expect((await closureBlockers("u1"))[0]).toMatchObject({ code: "pending_transactions" });
  });

  it("blocks on a locked balance, not only an available one", async () => {
    h.balances = [{ available: 0n, locked: 1n }];
    expect((await closureBlockers("u1"))[0]).toMatchObject({ code: "nonzero_balance" });
  });
});
