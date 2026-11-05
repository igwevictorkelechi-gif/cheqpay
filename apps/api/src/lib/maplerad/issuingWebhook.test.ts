import { afterEach, describe, expect, it, vi } from "vitest";
import { handleIssuingEvent, normalizeIssuingEvent, type CardStorePort } from "./issuing";
import { cardStore } from "../cards";

// The card store's own collaborators, for the cardStore tests at the bottom.
const h = vi.hoisted(() => ({
  cardUpdateMany: vi.fn(),
  cardFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  refund: vi.fn(),
  devFinalize: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("@cheqpay/db", () => ({
  prisma: {
    card: { updateMany: h.cardUpdateMany, findUnique: h.cardFindUnique },
    auditLog: { create: h.auditCreate },
  },
}));
vi.mock("../cardFunding", () => ({ refundCardIssueFee: h.refund }));
vi.mock("../devapi/cards", () => ({ finalizeDevCard: h.devFinalize }));
vi.mock("../opsAlert", () => ({ alertOpsOnce: h.alert }));

// Payloads as documented at https://maplerad.dev/docs/issuing.
const CREATED_OK = {
  event: "issuing.created.successful",
  reference: "xxxx",
  card: {
    id: "fe796aef-5dca-47d5-a542-16d403b464d1",
    name: "JOHN DOE",
    masked_pan: "536898******1914",
    type: "VIRTUAL",
    issuer: "VISA",
    currency: "USD",
    status: "ACTIVE",
    balance: 0,
    auto_approve: true,
  },
};

const CREATED_FAILED = {
  eventId: "73d842a0-0fc5-4200-a122-08018f131d1f",
  eventType: "issuing.created.failed",
  payload: {
    event: "issuing.created.failed",
    reference: "card_req_sim_1791964393184440000",
    status: "Rejected",
    reason: "Facial verification mismatch: Selfie does not match passport photo",
    verification_link: "https://maplerad.com/flow/retry/kyc_retry_sim_1791964393184440000",
    link_expire_at: "2026-10-15T18:00:00Z",
  },
};

const TRANSACTION = {
  event: "issuing.transaction",
  reference: "txn_ref_7f3a9c",
  card_id: "fe796aef-5dca-47d5-a542-16d403b464d1",
  amount: 1500,
  currency: "USD",
  type: "DEBIT",
  status: "SUCCESS",
  description: "AMAZON.COM",
};

const TERMINATED = {
  event: "issuing.terminated",
  reference: "term_ref_19b2",
  card_id: "fe796aef-5dca-47d5-a542-16d403b464d1",
  status: "SUCCESS",
  balance: 0,
};

type FinalizeInput = Parameters<CardStorePort["finalizeCard"]>[0];

function fakeStore() {
  const calls: FinalizeInput[] = [];
  const store: CardStorePort = {
    async finalizeCard(input) {
      calls.push(input);
    },
  };
  return { store, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("handleIssuingEvent", () => {
  it("settles the flat issuing.created.successful card", async () => {
    const { store, calls } = fakeStore();
    const outcome = await handleIssuingEvent(CREATED_OK, store);

    expect(outcome).toEqual({ action: "finalized" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      reference: "xxxx",
      cardId: "fe796aef-5dca-47d5-a542-16d403b464d1",
      status: "SUCCESS",
    });
    expect(calls[0].raw.masked_pan).toBe("536898******1914");
    expect(calls[0].raw.brand).toBe("VISA");
  });

  it("settles the wrapped issuing.created.failed card with its reason and retry link", async () => {
    const { store, calls } = fakeStore();
    const outcome = await handleIssuingEvent(CREATED_FAILED, store);

    expect(outcome).toEqual({ action: "finalized" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ reference: "card_req_sim_1791964393184440000", status: "FAILED" });
    expect(calls[0].raw.reason).toBe("Facial verification mismatch: Selfie does not match passport photo");
    expect(calls[0].raw.verification_link).toBe(
      "https://maplerad.com/flow/retry/kyc_retry_sim_1791964393184440000",
    );
    expect(calls[0].raw.link_expire_at).toBe("2026-10-15T18:00:00Z");
  });

  it("still settles the legacy data-wrapped shape", async () => {
    const { store, calls } = fakeStore();
    const outcome = await handleIssuingEvent(
      { event: "issuing.created.successful", data: { reference: "r1", card_id: "c1", status: "SUCCESS" } },
      store,
    );

    expect(outcome).toEqual({ action: "finalized" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ reference: "r1", cardId: "c1", status: "SUCCESS" });
  });

  it("does not settle a card from issuing.transaction", async () => {
    const { store, calls } = fakeStore();
    const outcome = await handleIssuingEvent(TRANSACTION, store);

    expect(calls).toHaveLength(0);
    expect(outcome).toEqual({ action: "ignored", reason: "issuing.transaction" });
  });

  it("does not settle a card from issuing.terminated", async () => {
    const { store, calls } = fakeStore();
    const outcome = await handleIssuingEvent(TERMINATED, store);

    expect(calls).toHaveLength(0);
    expect(outcome.action).toBe("ignored");
  });

  it("ignores, and reports, a creation event with no reference", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store, calls } = fakeStore();
    const { reference: _drop, ...noRef } = CREATED_OK;
    const outcome = await handleIssuingEvent(noRef, store);

    expect(calls).toHaveLength(0);
    expect(outcome).toEqual({ action: "ignored", reason: "no_reference" });
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("normalizeIssuingEvent", () => {
  it("reads the name from eventType when event is absent", () => {
    const n = normalizeIssuingEvent({ eventType: "issuing.created.failed", payload: { reference: "r2" } });
    expect(n.name).toBe("issuing.created.failed");
    expect(n.reference).toBe("r2");
    expect(n.status).toBe("FAILED");
  });

  it("derives status from the name, not card.status", () => {
    const n = normalizeIssuingEvent(CREATED_OK);
    expect(n.status).toBe("SUCCESS");
    expect(n.raw).toMatchObject({ card: { status: "ACTIVE" } });
  });

  it("keeps the raw status for other issuing events", () => {
    expect(normalizeIssuingEvent(TRANSACTION).status).toBe("SUCCESS");
    expect(normalizeIssuingEvent({ event: "issuing.charge", data: { status: "PENDING" } }).status).toBe("PENDING");
  });

  it.each([null, undefined, "x", 42, [], {}])("returns an empty name for %j without throwing", (input) => {
    const n = normalizeIssuingEvent(input);
    expect(n.name).toBe("");
    expect(n.reference).toBeUndefined();
    expect(n.raw).toEqual({});
  });
});

describe("cardStore.finalizeCard, fed by the webhook", () => {
  function primeAppCard() {
    h.cardUpdateMany.mockResolvedValue({ count: 1 });
    h.cardFindUnique.mockResolvedValue({ id: "card-1", userId: "user-1" });
    h.auditCreate.mockResolvedValue({});
    h.refund.mockResolvedValue(undefined);
    h.alert.mockResolvedValue(true);
  }

  it("activates the card with the masked PAN and brand from the flat payload", async () => {
    primeAppCard();
    await handleIssuingEvent(CREATED_OK, cardStore);

    expect(h.cardUpdateMany).toHaveBeenCalledWith({
      where: { reference: "xxxx" },
      data: {
        providerCardId: "fe796aef-5dca-47d5-a542-16d403b464d1",
        status: "active",
        maskedPan: "•••• 1914",
        brand: "VISA",
      },
    });
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it("on failure refunds, records why, and alerts ops", async () => {
    primeAppCard();
    await handleIssuingEvent(CREATED_FAILED, cardStore);

    const reference = "card_req_sim_1791964393184440000";
    expect(h.cardUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reference }, data: expect.objectContaining({ status: "failed" }) }),
    );
    expect(h.refund).toHaveBeenCalledWith({ reference });
    expect(h.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "card.issue_failed",
        resourceType: "Card",
        resourceId: "card-1",
        details: {
          via: "webhook",
          reference,
          reason: "Facial verification mismatch: Selfie does not match passport photo",
          verificationLink: "https://maplerad.com/flow/retry/kyc_retry_sim_1791964393184440000",
          linkExpiresAt: "2026-10-15T18:00:00Z",
          refunded: true,
        },
      },
    });
    expect(h.alert).toHaveBeenCalledWith(
      "card-issue-failed-webhook",
      expect.stringContaining("Facial verification mismatch"),
      expect.objectContaining({ reference }),
    );
  });

  it("never throws when the audit write fails", async () => {
    primeAppCard();
    h.auditCreate.mockRejectedValue(new Error("db down"));
    await expect(handleIssuingEvent(CREATED_FAILED, cardStore)).resolves.toEqual({ action: "finalized" });
    expect(h.refund).toHaveBeenCalledOnce();
  });

  it("says so in the audit row when the refund itself failed", async () => {
    primeAppCard();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.refund.mockRejectedValue(new Error("deadlock"));
    await handleIssuingEvent(CREATED_FAILED, cardStore);

    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ refunded: false }) }) }),
    );
  });

  it("hands a reference no app card owns to the developer-API cards", async () => {
    primeAppCard();
    h.cardUpdateMany.mockResolvedValue({ count: 0 });
    h.devFinalize.mockResolvedValue(true);
    await handleIssuingEvent(CREATED_OK, cardStore);

    expect(h.devFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "xxxx",
        cardId: "fe796aef-5dca-47d5-a542-16d403b464d1",
        status: "SUCCESS",
        raw: expect.objectContaining({ masked_pan: "536898******1914", brand: "VISA" }),
      }),
    );
    expect(h.refund).not.toHaveBeenCalled();
  });
});
