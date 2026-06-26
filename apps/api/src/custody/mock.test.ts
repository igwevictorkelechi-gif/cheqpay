import { describe, expect, it } from "vitest";
import { Asset, Network } from "@cheqpay/db";
import { MockCustodyProvider } from "./mock";

const provider = new MockCustodyProvider("test-secret");

describe("MockCustodyProvider", () => {
  it("generates deterministic, network-prefixed addresses", async () => {
    const a = await provider.createDepositAddress({
      userId: "u1",
      asset: Asset.BTC,
      network: Network.BITCOIN,
    });
    const b = await provider.createDepositAddress({
      userId: "u1",
      asset: Asset.BTC,
      network: Network.BITCOIN,
    });
    expect(a).toEqual(b); // deterministic
    expect(a.address.startsWith("bc1mock")).toBe(true);
    expect(a.custodyRef.startsWith("mock-va-")).toBe(true);
  });

  it("derives different addresses per asset/network/user", async () => {
    const btc = await provider.createDepositAddress({
      userId: "u1",
      asset: Asset.BTC,
      network: Network.BITCOIN,
    });
    const usdt = await provider.createDepositAddress({
      userId: "u1",
      asset: Asset.USDT,
      network: Network.TRON,
    });
    const other = await provider.createDepositAddress({
      userId: "u2",
      asset: Asset.BTC,
      network: Network.BITCOIN,
    });
    expect(btc.address).not.toBe(usdt.address);
    expect(btc.address).not.toBe(other.address);
  });

  it("verifies a correct webhook signature and rejects tampering", () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = provider.sign(body);
    expect(provider.verifyWebhookSignature(body, sig)).toBe(true);
    expect(provider.verifyWebhookSignature(body, "wrong")).toBe(false);
    expect(provider.verifyWebhookSignature(body, null)).toBe(false);
    expect(provider.verifyWebhookSignature(body + "tampered", sig)).toBe(false);
  });

  it("parses a valid deposit event and rejects junk", () => {
    const ok = provider.parseDepositEvent({
      eventId: "evt-1",
      address: "Tmockabc",
      amount: "12.5",
      txHash: "0xdead",
      asset: "USDT",
      network: "TRON",
    });
    expect(ok?.asset).toBe(Asset.USDT);
    expect(ok?.network).toBe(Network.TRON);

    expect(provider.parseDepositEvent({})).toBeNull();
    expect(
      provider.parseDepositEvent({
        eventId: "e",
        address: "a",
        amount: "1",
        txHash: "t",
        asset: "DOGE",
        network: "TRON",
      })
    ).toBeNull();
  });
});
