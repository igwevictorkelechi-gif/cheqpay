import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleradProvider } from "./maplerad";
import { BillPaymentError } from "./types";

const BASE = "https://api.maplerad.test/v1";
const psp = new MapleradProvider("sk-test", BASE);

/**
 * Response shapes below are copied from real Maplerad sandbox responses — in
 * particular cable, which nests plans under `payment_options` (an earlier guess
 * of `subscription_plans` made every cable purchase throw a TypeError).
 */
const ROUTES: Record<string, unknown> = {
  "GET /bills/data/bundle/mtn-data-ng": [
    { name: "1GB · 30 days", price: 10_000, code: "BUNDLE-1GB", validity: "Monthly" },
  ],
  "POST /bills/data": { id: "mp_tx_1", status: "SUCCESS" },
  "POST /bills/airtime": { id: "mp_air_1", status: "SUCCESS" },
  "POST /bills/electricity": { id: "mp_ele_1", status: "SUCCESS", token: "1234-5678" },
  "GET /bills/cable/subscriptions/dstv-ng": [
    {
      title: "Dstv Jinja Bouquet",
      plan_id: "DSTVNJ1",
      payment_options: [
        { subscription_id: "sub-1-month", duration: { value: 1, type: "monthly" }, price: 5_000 },
        { subscription_id: "sub-2-month", duration: { value: 2, type: "monthly" }, price: 10_000 },
      ],
    },
  ],
  "POST /bills/cable": { id: "mp_cab_1", status: "SUCCESS" },
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

const base = { customer: "08030000000", reference: "tx-1" };

describe("MapleradProvider — bills", () => {
  it("always buys airtime through the single ng-airtime identifier", async () => {
    const sent = stubMaplerad();
    const r = await psp.payBill({
      ...base,
      service: "airtime",
      billerCode: "mtn-ng",
      amount: "500",
    });

    expect(r).toEqual({ providerRef: "mp_air_1", status: "successful" });
    // Exactly one call: no biller lookup, and the amount is kobo, not naira.
    expect(sent).toEqual([
      {
        key: "POST /bills/airtime",
        body: { identifier: "ng-airtime", phone_number: "08030000000", amount: 50_000 },
      },
    ]);
  });

  it("buys exactly the data bundle the user picked, by its code", async () => {
    const sent = stubMaplerad();
    const r = await psp.payBill({
      ...base,
      service: "data",
      billerCode: "mtn-data-ng",
      planCode: "BUNDLE-1GB",
      amount: "100",
    });

    expect(r).toEqual({ providerRef: "mp_tx_1", status: "successful" });
    // One call: the bundle is named outright, never inferred from the price.
    expect(sent).toEqual([
      {
        key: "POST /bills/data",
        body: {
          identifier: "mtn-data-ng",
          bundle_identifier: "BUNDLE-1GB",
          phone_number: "08030000000",
          amount: 10_000,
        },
      },
    ]);
  });

  it("buys exactly the cable subscription the user picked", async () => {
    const sent = stubMaplerad();
    const r = await psp.payBill({
      ...base,
      service: "cabletv",
      billerCode: "dstv-ng",
      planCode: "sub-2-month",
      customer: "1234567890",
      amount: "100",
    });

    expect(r).toEqual({ providerRef: "mp_cab_1", status: "successful" });
    expect(sent).toEqual([
      {
        key: "POST /bills/cable",
        body: {
          identifier: "dstv-ng",
          serial_number: "1234567890",
          amount: 10_000,
          subscription_id: "sub-2-month",
        },
      },
    ]);
  });

  it("refuses a fixed-price purchase with no plan code instead of guessing by price", async () => {
    const sent = stubMaplerad();
    for (const service of ["data", "cabletv"]) {
      const err = await psp
        .payBill({ ...base, service, billerCode: "mtn-data-ng", amount: "100" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BillPaymentError);
      expect(err.providerMessage).toMatch(/no longer offered/);
    }
    expect(sent).toHaveLength(0); // nothing reached the provider
  });

  it("pays electricity on the exact meter type chosen, and returns the token", async () => {
    const sent = stubMaplerad();
    const r = await psp.payBill({
      ...base,
      service: "electricity",
      billerCode: "ikeja-electricity-prepaid-ng", // prepaid, not postpaid
      customer: "04223456789",
      amount: "5000",
    });

    expect(r).toEqual({
      providerRef: "mp_ele_1",
      status: "successful",
      token: "1234-5678",
    });
    expect(sent.at(-1)).toEqual({
      key: "POST /bills/electricity",
      body: {
        identifier: "ikeja-electricity-prepaid-ng",
        meter_number: "04223456789",
        phone_number: "04223456789",
        amount: 500_000,
      },
    });
  });

  it("rejects the services Maplerad has no billers for", async () => {
    stubMaplerad();
    for (const service of ["betting", "food"]) {
      const err = await psp
        .payBill({ ...base, service, billerCode: "whatever", amount: "100" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BillPaymentError);
      // The reason reaches the user — the route surfaces providerMessage on refund.
      expect(err.providerMessage).toMatch(/does not offer/);
    }
  });

  it("refuses a biller that has no Maplerad identifier", async () => {
    const sent = stubMaplerad();
    const err = await psp
      .payBill({ ...base, service: "data", billerCode: undefined, amount: "100" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BillPaymentError);
    expect(err.providerMessage).toMatch(/no Maplerad identifier/);
    expect(sent).toHaveLength(0); // refused before any provider call
  });

  it("rejects a non-positive amount before calling the provider", async () => {
    const sent = stubMaplerad();
    await expect(
      psp.payBill({ ...base, service: "data", billerCode: "mtn-data-ng", amount: "0" })
    ).rejects.toThrow(BillPaymentError);
    expect(sent).toHaveLength(0);
  });

  it("maps provider statuses onto the rail's three states", async () => {
    for (const [given, expected] of [
      ["SUCCESS", "successful"],
      ["FAILED", "failed"],
      ["PENDING", "pending"],
    ] as const) {
      stubMaplerad({ ...ROUTES, "POST /bills/airtime": { id: "mp_1", status: given } });
      const r = await psp.payBill({
        ...base,
        service: "airtime",
        billerCode: "mtn-ng",
        amount: "100",
      });
      expect(r.status).toBe(expected);
      vi.unstubAllGlobals();
    }
  });
});

describe("MapleradProvider — live plan lists", () => {
  it("lists real data bundles with their codes and kobo prices", async () => {
    stubMaplerad();
    await expect(psp.listBillPlans("data", "mtn-data-ng")).resolves.toEqual([
      { code: "BUNDLE-1GB", name: "1GB · 30 days", amountMinor: 10_000 },
    ]);
  });

  it("flattens cable bouquets into one plan per duration", async () => {
    stubMaplerad();
    // A bouquet sells at several durations; each is a separately buyable plan
    // with its own subscription id, so they must not collapse into one.
    await expect(psp.listBillPlans("cabletv", "dstv-ng")).resolves.toEqual([
      { code: "sub-1-month", name: "Dstv Jinja Bouquet", amountMinor: 5_000 },
      { code: "sub-2-month", name: "Dstv Jinja Bouquet · 2 months", amountMinor: 10_000 },
    ]);
  });
});

describe("MapleradProvider — money movement", () => {
  it("sends a payout in kobo, keyed by our transaction id for idempotency", async () => {
    const sent = stubMaplerad({ "POST /transfers": { id: "mp_tr_1", status: "PENDING" } });
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
          amount: 250_050, // ₦2 500.50 in kobo, never naira
          currency: "NGN",
          reason: "Cheqpay withdrawal",
          reference: "tx-payout-1",
        },
      },
    ]);
  });

  it("falls back to our reference when the payout response carries no id", async () => {
    // Maplerad's documented 200 body for /transfers echoes the request, with no
    // id and no status. Settlement matches on our reference either way, but
    // externalRef must not end up unset.
    stubMaplerad({ "POST /transfers": { bank_code: "044", amount: 250_050 } });
    const r = await psp.initiateTransfer({
      amount: "2500.50",
      bankCode: "044",
      accountNumber: "0690000031",
      reference: "tx-payout-2",
    });

    expect(r).toEqual({ providerRef: "tx-payout-2", status: "pending" });
  });

  it("resolves an account name before we send money to it", async () => {
    const sent = stubMaplerad({ "POST /institutions/resolve": { account_name: "ADA OKAFOR" } });
    await expect(
      psp.resolveBankAccount({ accountNumber: "0690000031", bankCode: "044" })
    ).resolves.toEqual({ accountName: "ADA OKAFOR" });

    // account_number and bank_code are the whole request schema — a `currency`
    // used to be sent too, and was never read.
    expect(sent[0].body).toEqual({ bank_code: "044", account_number: "0690000031" });
  });

  it("pages through the bank list instead of returning only the first 100", async () => {
    // Nigeria has more than 100 NUBAN institutions once microfinance banks are
    // counted. Returning one page dropped the tail silently, and the user whose
    // bank fell past the cut saw no error — just a bank that wasn't listed.
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ name: `Bank ${n}-${i}`, code: `${n}${i}` }));

    const sent = stubMaplerad({
      "GET /institutions?type=NUBAN&country=NG&page=1&page_size=100": page(1, 100),
      "GET /institutions?type=NUBAN&country=NG&page=2&page_size=100": page(2, 100),
      "GET /institutions?type=NUBAN&country=NG&page=3&page_size=100": page(3, 37),
    });

    const banks = await psp.listBanks();

    expect(banks).toHaveLength(237);
    expect(sent).toHaveLength(3); // stopped on the short page, did not keep going
  });

  it("refuses to mint a virtual account for a user with no Maplerad customer", async () => {
    // A collection account hangs off a customer id. Without one there is
    // nothing to attach it to, and saying so beats letting Maplerad answer with
    // a 400 that names a field the operator has never heard of.
    await expect(
      psp.createVirtualAccount({
        email: "a@b.com",
        firstName: "Ada",
        lastName: "Okafor",
        permanent: true,
        txRef: "va_1",
      })
    ).rejects.toThrow(/no Maplerad customer record/i);
  });

  it("opens a permanent collection account for an enrolled customer", async () => {
    // The stub mirrors the documented response exactly. It used to include a
    // bank_code, which this endpoint does not return — so the test was
    // confirming a field the provider could never actually supply.
    const sent = stubMaplerad({
      "POST /collections/virtual-account": {
        id: "acc_123",
        account_number: "9900000001",
        account_name: "ADA OKAFOR",
        bank_name: "Wema Bank",
        currency: "NGN",
      },
    });

    await expect(
      psp.createVirtualAccount({
        email: "a@b.com",
        firstName: "Ada",
        lastName: "Okafor",
        permanent: true,
        txRef: "va_1",
        mapleradCustomerId: "cus_abc",
      })
    ).resolves.toEqual({
      accountNumber: "9900000001",
      bankName: "Wema Bank",
      // The response carries account_name; it is captured, not dropped.
      accountName: "ADA OKAFOR",
      // Not in the response; must not be invented from the bank name.
      bankCode: undefined,
      providerRef: "acc_123",
      // Always permanent: a static account is created once and reused forever.
      permanent: true,
    });

    // With no preferred bank configured, only customer_id and currency are sent.
    // An unexpected field is exactly the kind of thing a provider rejects with a
    // 400 naming a parameter nobody here has heard of.
    const body = sent.find((c) => c.key === "POST /collections/virtual-account")?.body;
    expect(body).toEqual({ customer_id: "cus_abc", currency: "NGN" });
  });

  it("requests a specific bank when MAPLERAD_PREFERRED_BANK is set", async () => {
    // The env var carries a VIRTUAL-institution identifier (e.g. Moniepoint's);
    // when present it is forwarded as preferred_bank so the NUBAN is minted there.
    vi.stubEnv("MAPLERAD_PREFERRED_BANK", "moniepoint-ng");
    const sent = stubMaplerad({
      "POST /collections/virtual-account": {
        id: "acc_124",
        account_number: "5000000002",
        account_name: "ADA OKAFOR",
        bank_name: "Moniepoint MFB",
        currency: "NGN",
      },
    });

    const r = await psp.createVirtualAccount({
      email: "a@b.com",
      firstName: "Ada",
      lastName: "Okafor",
      permanent: true,
      txRef: "va_2",
      mapleradCustomerId: "cus_abc",
    });
    expect(r.bankName).toBe("Moniepoint MFB");

    const body = sent.find((c) => c.key === "POST /collections/virtual-account")?.body;
    expect(body).toEqual({
      customer_id: "cus_abc",
      currency: "NGN",
      preferred_bank: "moniepoint-ng",
    });
    vi.unstubAllEnvs();
  });

  it("does not hand back an account without a number", async () => {
    // A 2xx with a missing account_number would otherwise be persisted as the
    // user's NUBAN, and every future deposit to it would be unplaceable.
    stubMaplerad({
      "POST /collections/virtual-account": { id: "acc_123", bank_name: "Wema Bank" },
    });

    await expect(
      psp.createVirtualAccount({
        email: "a@b.com",
        firstName: "Ada",
        lastName: "Okafor",
        permanent: true,
        txRef: "va_1",
        mapleradCustomerId: "cus_abc",
      })
    ).rejects.toThrow(/no account number/i);
  });

  it("defers webhook verification to the Svix route", () => {
    expect(() => psp.verifyWebhookSignature()).toThrow(/Svix/);
    expect(psp.parseChargeEvent()).toBeNull();
    expect(psp.parseTransferEvent()).toBeNull();
  });
});
