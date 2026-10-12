// The card top-up and withdraw routes answer after the money has moved, so a
// response that can't be serialised (a bigint fee) turned a successful
// movement into a 500 in the user's face. These pin the JSON shape.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ensureCards", () => ({ ensureCardsTable: vi.fn(async () => undefined) }));
vi.mock("@/lib/transactionPin", () => ({ readPin: () => "1234", requireTransactionPin: vi.fn(async () => undefined) }));
vi.mock("@/lib/cardFunding", () => ({
  fundUserCard: vi.fn(async () => ({ transactionId: "tx-1", status: "COMPLETED", feeCents: 150n })),
  withdrawUserCard: vi.fn(async () => ({ transactionId: "tx-2", status: "COMPLETED", feeCents: 100n })),
}));

import { POST as fund } from "./[id]/fund/route";
import { POST as withdraw } from "./[id]/withdraw/route";

const req = () =>
  new Request("https://api.test/api/cards/c1/fund", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "k-1" },
    body: JSON.stringify({ amount: "10" }),
  });

describe("card money routes", () => {
  it("answer a completed top-up with the fee as a string, not a crash", async () => {
    const res = await fund(req(), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transactionId: "tx-1", status: "COMPLETED", feeCents: "150" });
  });

  it("answer a completed withdrawal the same way", async () => {
    const res = await withdraw(req(), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transactionId: "tx-2", status: "COMPLETED", feeCents: "100" });
  });
});
