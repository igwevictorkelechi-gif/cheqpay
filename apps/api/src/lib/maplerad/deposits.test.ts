import { describe, expect, it, vi } from "vitest";
import { handleCollectionEvent, type LedgerPort } from "./deposits";
import type { CollectionEventData, MapleradWebhookEvent } from "./types";

function event(data: Partial<CollectionEventData>): MapleradWebhookEvent<CollectionEventData> {
  return { event: "collection.successful", data: data as CollectionEventData };
}

function ledger(over: Partial<LedgerPort> = {}): LedgerPort {
  return {
    hasProcessed: vi.fn().mockResolvedValue(false),
    findUserByAccount: vi.fn().mockResolvedValue({ userId: "u1" }),
    creditUser: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("handleCollectionEvent", () => {
  it("credits a settled deposit and forwards the currency to both halves", async () => {
    const l = ledger();
    const res = await handleCollectionEvent(
      event({ id: "tx1", status: "SUCCESS", amount: 5000, currency: "USD", account_number: "83001" }),
      l,
    );

    expect(res).toMatchObject({ outcome: "credited", userId: "u1", amount: 5000 });
    // The matcher is told the currency, so it can target the USD wallet.
    expect(l.findUserByAccount).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", accountNumber: "83001" }),
    );
    expect(l.creditUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", amountMinor: 5000, currency: "USD" }),
    );
  });

  it("skips a non-settled status without crediting", async () => {
    const l = ledger();
    const res = await handleCollectionEvent(event({ id: "tx2", status: "PENDING", amount: 100 }), l);
    expect(res.outcome).toBe("ignored");
    expect(l.creditUser).not.toHaveBeenCalled();
  });

  it("does not credit twice for the same provider transaction id", async () => {
    const l = ledger({ hasProcessed: vi.fn().mockResolvedValue(true) });
    const res = await handleCollectionEvent(event({ id: "tx3", amount: 100, currency: "USD" }), l);
    expect(res.outcome).toBe("duplicate");
    expect(l.creditUser).not.toHaveBeenCalled();
  });

  it("returns unmatched (not an error) when no owner is found", async () => {
    const l = ledger({ findUserByAccount: vi.fn().mockResolvedValue(null) });
    const res = await handleCollectionEvent(event({ id: "tx4", amount: 100, currency: "USD" }), l);
    expect(res.outcome).toBe("unmatched");
    expect(l.creditUser).not.toHaveBeenCalled();
  });

  it("ignores a non-positive amount", async () => {
    const l = ledger();
    const res = await handleCollectionEvent(event({ id: "tx5", amount: 0, currency: "USD" }), l);
    expect(res.outcome).toBe("ignored");
  });
});
