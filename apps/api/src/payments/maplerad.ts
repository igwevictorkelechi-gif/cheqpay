// apps/api/src/payments/maplerad.ts
//
// Maplerad is the NGN rail, implementing PaymentProvider (see ./types).
//
// Supported: bills (airtime, data, electricity, cable TV), bank payouts, name
// enquiry and the bank list.
//
// NOT supported yet: NGN deposits. Maplerad has not enabled collections on the
// business, so virtual-account creation fails for every bank; createVirtualAccount
// throws a clear error until that is switched on.
//
// Betting and food have no Maplerad biller at all — they are marked "coming soon"
// in the catalog (lib/bills.ts) and never reach this rail.
//
// Amounts crossing the PaymentProvider boundary are NGN decimal strings; we
// convert to kobo (integer) for Maplerad and back.

import {
  BillPaymentError,
  type Bank,
  type BillPayInput,
  type BillPayResult,
  type BillValidateInput,
  type BillValidateResult,
  type CreateVirtualAccountInput,
  type NgnChargeEvent,
  type NgnTransferEvent,
  type PaymentProvider,
  type ResolveAccountInput,
  type ResolveAccountResult,
  type TransferResult,
  type VirtualAccountResult,
} from "./types";

const DEPOSITS_UNAVAILABLE =
  "NGN deposits are temporarily unavailable: Maplerad has not enabled collections on this business yet.";

/** NGN decimal string -> kobo integer. "100" -> 10000. */
function toKobo(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

export class MapleradProvider implements PaymentProvider {
  readonly name = "maplerad";

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = process.env.MAPLERAD_BASE_URL ?? "https://api.maplerad.com/v1",
  ) {}

  // ---- HTTP helper --------------------------------------------------------

  private async req<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok || json?.status === false) {
      const msg = json?.message ?? `HTTP ${res.status}`;
      throw new BillPaymentError(`Maplerad ${method} ${path} failed`, String(msg), res.status);
    }
    return (json.data ?? json) as T;
  }

  /**
   * The catalog stores Maplerad's exact biller identifier, so there is nothing
   * to look up or guess. This used to fuzzy-match a brand token against the
   * biller list, which silently picked the wrong meter type (prepaid vs postpaid
   * are separate billers) and could not find Kano's disco at all.
   */
  private identifier(input: { billerCode?: string }): string {
    if (!input.billerCode) {
      throw new BillPaymentError(
        "Biller is not available",
        "This biller has no Maplerad identifier, so it cannot be paid.",
      );
    }
    return input.billerCode;
  }

  // ---- Bills (SUPPORTED) --------------------------------------------------

  async payBill(input: BillPayInput): Promise<BillPayResult> {
    const kobo = toKobo(input.amount);
    if (!Number.isInteger(kobo) || kobo <= 0) {
      throw new BillPaymentError("Invalid bill amount", "Amount must be a positive number");
    }

    switch (input.service) {
      case "airtime":
        return this.payAirtime(input, kobo);
      case "data":
        return this.payData(input, kobo);
      case "electricity":
        return this.payElectricity(input, kobo);
      case "cabletv":
        return this.payCable(input, kobo);
      case "betting":
      case "food":
      default:
        throw new BillPaymentError(
          `${input.service} is not supported on the Maplerad rail`,
          `Maplerad does not offer ${input.service}.`,
        );
    }
  }

  /** Airtime: no plan to resolve — the amount is whatever the user typed. */
  private async payAirtime(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const r = await this.req<{ id: string; status: string }>("/bills/airtime", "POST", {
      identifier: this.identifier(input), // e.g. "mtn-ng"
      phone_number: input.customer,
      amount: kobo,
    });
    return { providerRef: r.id, status: normalizeStatus(r.status) };
  }

  private async payData(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const identifier = this.identifier(input);
    const bundles = await this.req<Array<{ name: string; price: number; code: string }>>(
      `/bills/data/bundle/${identifier}`,
    );
    // Match the plan by exact price (kobo). Requiring an exact match means a
    // catalog price with no real bundle behind it is refused rather than
    // silently selling the customer a different bundle.
    const bundle = bundles.find((b) => b.price === kobo);
    if (!bundle) {
      throw new BillPaymentError(
        "No matching data bundle",
        `No ${identifier} bundle priced at ₦${(kobo / 100).toFixed(2)}. Align the catalog plan to a real Maplerad bundle.`,
      );
    }
    const r = await this.req<{ id: string; status: string }>("/bills/data", "POST", {
      identifier,
      bundle_identifier: bundle.code,
      phone_number: input.customer,
      amount: kobo,
    });
    return { providerRef: r.id, status: normalizeStatus(r.status) };
  }

  private async payElectricity(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    // The identifier already encodes prepaid vs postpaid — the customer picked it.
    const r = await this.req<{ id: string; status: string; token?: string }>(
      "/bills/electricity",
      "POST",
      {
        meter_number: input.customer,
        identifier: this.identifier(input),
        amount: kobo,
        phone_number: input.customer,
      },
    );
    return { providerRef: r.id, status: normalizeStatus(r.status), token: r.token ?? null };
  }

  private async payCable(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const identifier = this.identifier(input);
    // Cable needs a subscription_id. Maplerad groups plans by bouquet, each with
    // `payment_options` (one per duration) carrying the id and price.
    const bouquets = await this.req<
      Array<{
        title: string;
        plan_id: string;
        payment_options?: Array<{ subscription_id: string; price: number }>;
      }>
    >(`/bills/cable/subscriptions/${identifier}`);

    const plan = bouquets
      .flatMap((b) => b.payment_options ?? [])
      .find((p) => p.price === kobo);
    if (!plan) {
      throw new BillPaymentError(
        "No matching cable plan",
        `No ${identifier} plan priced at ₦${(kobo / 100).toFixed(2)}. Align the catalog plan to a real Maplerad subscription.`,
      );
    }
    const r = await this.req<{ id: string; status: string }>("/bills/cable", "POST", {
      identifier,
      serial_number: input.customer,
      amount: kobo,
      subscription_id: plan.subscription_id,
    });
    return { providerRef: r.id, status: normalizeStatus(r.status) };
  }

  /**
   * Resolve an electricity meter to its owner's name. Maplerad exposes this for
   * electricity only; cable smartcards cannot be resolved, so we let those pass
   * and let the purchase itself reject a bad card. Never blocks on a provider
   * hiccup — a failed lookup must not stop a valid payment.
   */
  async validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult> {
    if (!input.billerCode?.includes("electricity") && !input.billerCode?.includes("electric")) {
      return { valid: true };
    }
    try {
      const r = await this.req<{ name: string }>("/bills/electricity/resolve-account", "POST", {
        meter_number: input.customer,
        identifier: input.billerCode,
      });
      return { valid: Boolean(r.name), customerName: r.name };
    } catch {
      return { valid: true };
    }
  }

  // ---- Payouts (money out) ------------------------------------------------

  async listBanks(): Promise<Bank[]> {
    const banks = await this.req<Array<{ name: string; code: string }>>(
      "/institutions?type=NUBAN&country=NG&page=1&page_size=100",
    );
    return banks.map((b) => ({ code: b.code, name: b.name }));
  }

  async resolveBankAccount(input: ResolveAccountInput): Promise<ResolveAccountResult> {
    const r = await this.req<{ account_name: string }>("/institutions/resolve", "POST", {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
      currency: "NGN",
    });
    return { accountName: r.account_name };
  }

  /**
   * NGN bank payout. `reference` is our transaction id and doubles as the
   * idempotency key, so a retry after a network blip cannot double-send.
   * The final status arrives asynchronously on the transfer.* webhook.
   */
  async initiateTransfer(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    reference: string;
    narration?: string;
  }): Promise<TransferResult> {
    const r = await this.req<{ id: string; status?: string }>("/transfers", "POST", {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
      amount: toKobo(input.amount),
      currency: "NGN",
      reason: input.narration,
      reference: input.reference,
    });
    return {
      providerRef: r.id,
      status: r.status ? normalizeStatus(r.status) : "pending",
    };
  }

  // ---- Deposits (money in) — BLOCKED --------------------------------------

  /**
   * Maplerad NGN virtual accounts are not yet usable: collections are not
   * enabled on the business, so POST /collections/virtual-account returns 400
   * for every bank, even at KYC tier 2. Rather than half-create Maplerad
   * customers we cannot collect against, we fail loudly and explain why.
   *
   * To finish this once Maplerad enables collections: enroll the user as a
   * Maplerad customer (lib/maplerad/customers.ts), persist the customer id on
   * the User record, create a static account (lib/maplerad/accounts.ts), and
   * credit on the `collection.successful` webhook.
   */
  async createVirtualAccount(_i: CreateVirtualAccountInput): Promise<VirtualAccountResult> {
    throw new Error(DEPOSITS_UNAVAILABLE);
  }

  // ---- Webhooks -----------------------------------------------------------

  /**
   * Maplerad signs with Svix (svix-id / svix-timestamp / svix-signature), which
   * needs three headers — more than this single-signature interface carries.
   * Verification therefore lives in the dedicated route
   * (app/api/webhooks/maplerad/route.ts), which has the raw body and headers.
   */
  verifyWebhookSignature(): boolean {
    throw new Error(
      "Maplerad webhooks are Svix-signed; verify them in app/api/webhooks/maplerad/route.ts.",
    );
  }
  parseChargeEvent(): NgnChargeEvent | null { return null; }
  parseTransferEvent(): NgnTransferEvent | null { return null; }
}

function normalizeStatus(s: string): "successful" | "pending" | "failed" {
  const u = (s || "").toUpperCase();
  if (u === "SUCCESS" || u === "SUCCESSFUL" || u === "COMPLETED") return "successful";
  if (u === "FAILED" || u === "DECLINED") return "failed";
  return "pending";
}
