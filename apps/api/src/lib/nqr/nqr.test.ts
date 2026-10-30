import { describe, expect, it } from "vitest";
import { emvCrc16, getNqrProvider } from "./index";

describe("NQR mock provider", () => {
  const provider = getNqrProvider();

  it("is not a live provider (cross-bank QR is not actually available)", () => {
    expect(provider.live).toBe(false);
  });

  it("registers a merchant deterministically from the account number", async () => {
    const a = await provider.registerMerchant({ accountNumber: "0123456789", merchantName: "A" });
    const b = await provider.registerMerchant({ accountNumber: "0123456789", merchantName: "A" });
    const c = await provider.registerMerchant({ accountNumber: "9999999999", merchantName: "A" });
    expect(a.merchantId).toBe(b.merchantId);
    expect(a.merchantId).not.toBe(c.merchantId);
  });

  it("emits an EMVCo string with a valid CRC and the NGN currency", async () => {
    const { merchantId } = await provider.registerMerchant({ accountNumber: "0123456789", merchantName: "A" });
    const payload = await provider.generatePayload({ merchantId });
    // Starts with the payload format indicator, carries NGN (566), ends with CRC.
    expect(payload.startsWith("000201")).toBe(true);
    expect(payload).toContain("5303566");
    const body = payload.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(payload.slice(-4)).toBe(emvCrc16(body));
  });

  it("marks a fixed-amount code as dynamic and includes the amount", async () => {
    const { merchantId } = await provider.registerMerchant({ accountNumber: "0123456789", merchantName: "A" });
    const payload = await provider.generatePayload({ merchantId, amountMinor: 150000n });
    expect(payload).toContain("010212"); // point-of-initiation = dynamic
    expect(payload).toContain("54071500.00"); // amount tag, length 07, value 1500.00
  });
});
