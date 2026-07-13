import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleradProvider } from "./maplerad";
import { BillPaymentError } from "./types";

const BASE = "https://api.maplerad.test/v1";
const psp = new MapleradProvider("sk-test", BASE);

/** MTN data biller + a single ₦100 bundle (prices are kobo). */
const ROUTES: Record<string, unknown> = {
  "GET /bills/data/billers/NG": [{ name: "MTN", identifier: "mtn-data" }],
  "GET /bills/data/bundle/mtn-data": [
    { name: "1GB · 30 days", price: 10_000, code: "BUNDLE-1GB" },
  ],
  "POST /bills/data": { id: "mp_tx_1", status: "SUCCESS" },
};

/** Stub fetch with Maplerad's `{ data: ... }` envelope; record what was sent. */
function stubMaplerad(routes: Record<string, unknown> = ROUTES) {
  const sent: Array<{ key: string; body: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace(BASE, "")}`;
    sent.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!(key in routes)) {
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ data: routes[key] }), { status: 200 });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapleradProvider", () => {
  it("buys a data bundle whose price matches the catalog amount exactly", async () => {
    const sent = stubMaplerad();
    const r = await psp.payBill({
      service: "data",
      flwType: "DATA",
      flwBillerCode: "BIL099", // MTN
      customer: "08030000000",
      amount: "100", // ₦100 -> 10 000 kobo -> BUNDLE-1GB
      reference: "tx-1",
    });

    expect(r).toEqual({ providerRef: "mp_tx_1", status: "successful" });
    // The purchase must carry the bundle resolved by price, and kobo — not naira.
    expect(sent.at(-1)).toEqual({
      key: "POST /bills/data",
      body: {
        identifier: "mtn-data",
        bundle_identifier: "BUNDLE-1GB",
        phone_number: "08030000000",
        amount: 10_000,
      },
    });
  });

  it("refuses to buy when no bundle matches the price, rather than selling the wrong one", async () => {
    stubMaplerad();
    // ₦600 is a catalog price with no Maplerad bundle behind it.
    await expect(
      psp.payBill({
        service: "data",
        flwType: "DATA",
        flwBillerCode: "BIL099",
        customer: "08030000000",
        amount: "600",
        reference: "tx-2",
      })
    ).rejects.toThrow(/No matching data bundle/);
  });

  it("buys airtime without a biller lookup — the network comes from the number", async () => {
    const sent = stubMaplerad({
      ...ROUTES,
      "POST /bills/airtime": { id: "mp_air_1", status: "SUCCESS" },
    });
    const r = await psp.payBill({
      service: "airtime",
      flwType: "AIRTIME",
      flwBillerCode: "BIL099",
      customer: "08030000000",
      amount: "500",
      reference: "tx-air",
    });

    expect(r).toEqual({ providerRef: "mp_air_1", status: "successful" });
    // A single ng-airtime identifier, amount in kobo, and no billers/bundle lookup.
    expect(sent).toEqual([
      {
        key: "POST /bills/airtime",
        body: { identifier: "ng-airtime", phone_number: "08030000000", amount: 50_000 },
      },
    ]);
  });

  it("rejects the services Maplerad has no billers for", async () => {
    stubMaplerad();
    for (const service of ["betting", "food"]) {
      const err = await psp
        .payBill({
          service,
          flwType: "BETTING",
          flwBillerCode: "BIL310",
          customer: "user-1",
          amount: "100",
          reference: "tx-3",
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BillPaymentError);
      // The reason reaches the user (the route surfaces providerMessage on refund).
      expect(err.providerMessage).toMatch(/does not offer/);
    }
  });

  it("rejects a non-positive amount before calling the provider", async () => {
    const sent = stubMaplerad();
    await expect(
      psp.payBill({
        service: "data",
        flwType: "DATA",
        flwBillerCode: "BIL099",
        customer: "08030000000",
        amount: "0",
        reference: "tx-4",
      })
    ).rejects.toThrow(BillPaymentError);
    expect(sent).toHaveLength(0);
  });

  it("rejects a biller with no Maplerad mapping", async () => {
    stubMaplerad();
    await expect(
      psp.payBill({
        service: "data",
        flwType: "DATA",
        flwBillerCode: "BIL999", // not in FLW_TO_BRAND
        customer: "08030000000",
        amount: "100",
        reference: "tx-5",
      })
    ).rejects.toThrow(/Unmapped biller/);
  });

  it("maps provider statuses onto the rail's three states", async () => {
    for (const [given, expected] of [
      ["SUCCESS", "successful"],
      ["FAILED", "failed"],
      ["PENDING", "pending"],
    ] as const) {
      stubMaplerad({ ...ROUTES, "POST /bills/data": { id: "mp_1", status: given } });
      const r = await psp.payBill({
        service: "data",
        flwType: "DATA",
        flwBillerCode: "BIL099",
        customer: "08030000000",
        amount: "100",
        reference: "tx-6",
      });
      expect(r.status).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it("sends a payout in kobo, keyed by our transaction id for idempotency", async () => {
    const sent = stubMaplerad({
      "POST /transfers": { id: "mp_tr_1", status: "PENDING" },
    });
    const r = await psp.initiateTransfer({
      amount: "2500.50",
      bankCode: "044",
      accountNumber: "0690000031",
      reference: "tx-payout-1",
      narration: "Cheqpay withdrawal",
    });

    expect(r).toEqual({ providerRef: "mp_tr_1", status: "pending" });
    expect(sent).toEqual([
      {
        key: "POST /transfers",
        body: {
          bank_code: "044",
          account_number: "0690000031",
          amount: 250_050, // ₦2 500.50 -> kobo, never naira
          currency: "NGN",
          reason: "Cheqpay withdrawal",
          reference: "tx-payout-1",
        },
      },
    ]);
  });

  it("resolves an account name before we send money to it", async () => {
    stubMaplerad({ "POST /institutions/resolve": { account_name: "ADA OKAFOR" } });
    await expect(
      psp.resolveBankAccount({ accountNumber: "0690000031", bankCode: "044" })
    ).resolves.toEqual({ accountName: "ADA OKAFOR" });
  });

  it("refuses to mint a virtual account while Maplerad collections are disabled", async () => {
    // Deposits are dark by design until Maplerad enables collections; failing
    // loudly beats creating Maplerad customers we cannot collect against.
    await expect(
      psp.createVirtualAccount({
        email: "a@b.com",
        firstName: "Ada",
        lastName: "Okafor",
        permanent: true,
        txRef: "va_1",
      })
    ).rejects.toThrow(/deposits are temporarily unavailable/i);
  });

  it("defers webhook verification to the Svix route", () => {
    expect(() => psp.verifyWebhookSignature()).toThrow(/Svix/);
    expect(psp.parseChargeEvent()).toBeNull();
    expect(psp.parseTransferEvent()).toBeNull();
  });
});
