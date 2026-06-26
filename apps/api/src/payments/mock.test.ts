import { describe, expect, it } from "vitest";
import { MockPaymentProvider } from "./mock";

const psp = new MockPaymentProvider("secret-hash");

describe("MockPaymentProvider", () => {
  it("verifies a matching webhook secret and rejects others", () => {
    expect(psp.verifyWebhookSignature("{}", "secret-hash")).toBe(true);
    expect(psp.verifyWebhookSignature("{}", "wrong")).toBe(false);
    expect(psp.verifyWebhookSignature("{}", null)).toBe(false);
  });

  it("parses a charge event", () => {
    const e = psp.parseChargeEvent({
      type: "charge",
      eventId: "evt-1",
      txRef: "cheqpay-dep-1",
      amount: "5000.00",
      currency: "NGN",
      status: "successful",
      customerEmail: "a@b.com",
    });
    expect(e?.txRef).toBe("cheqpay-dep-1");
    expect(e?.status).toBe("successful");
    // not a transfer
    expect(psp.parseTransferEvent({ type: "charge" })).toBeNull();
  });

  it("parses a transfer event", () => {
    const e = psp.parseTransferEvent({
      type: "transfer",
      eventId: "evt-2",
      reference: "tx-123",
      status: "failed",
    });
    expect(e?.reference).toBe("tx-123");
    expect(e?.status).toBe("failed");
  });

  it("rejects malformed events", () => {
    expect(psp.parseChargeEvent({ type: "charge" })).toBeNull();
    expect(psp.parseChargeEvent({})).toBeNull();
    expect(psp.parseChargeEvent({ type: "charge", eventId: "e", txRef: "t", amount: "1", currency: "NGN", status: "bogus" })).toBeNull();
  });

  it("returns a deterministic transfer reference", async () => {
    const a = await psp.initiateTransfer({ amount: "100", bankCode: "044", accountNumber: "0690000031", reference: "tx-1" });
    const b = await psp.initiateTransfer({ amount: "100", bankCode: "044", accountNumber: "0690000031", reference: "tx-1" });
    expect(a.providerRef).toBe(b.providerRef);
    expect(a.status).toBe("new");
  });
});
