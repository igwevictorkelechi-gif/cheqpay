// apps/api/src/payments/maplerad.ts
//
// Maplerad is the NGN rail, implementing PaymentProvider (see ./types).
//
// Supported: bills (airtime, data, electricity, cable TV), bank payouts, name
// enquiry, the bank list, and NGN deposits via dedicated collection accounts.
//
// NGN deposits need collections enabled on the Maplerad business AND a KYC'd
// Maplerad customer per user — a static NUBAN hangs off a customer id. The
// account is opened at KYC approval and reused forever; incoming money arrives
// as a `collection.successful` webhook that credits the user's balance.
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
  type ProviderBillPlan,
  type ResolveAccountInput,
  type ResolveAccountResult,
  type TransferResult,
  type VirtualAccountResult,
} from "./types";

const DEPOSITS_UNAVAILABLE =
  "Cannot open a deposit account: this user has no Maplerad customer record yet. " +
  "Maplerad customer enrollment needs an approved KYC with BVN, date of birth, phone and street address.";

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

  /**
   * The exact plan the user picked, as published by listBillPlans. We refuse to
   * fall back to price-matching: two plans can share a price, and a stale price
   * would silently buy the wrong bundle.
   */
  private planCode(input: BillPayInput): string {
    if (!input.planCode) {
      throw new BillPaymentError(
        "Plan is not available",
        "This plan is no longer offered by Maplerad. Please pick another.",
      );
    }
    return input.planCode;
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

  /**
   * The plans a biller sells right now. The catalog calls this so users only
   * ever see bundles Maplerad can actually deliver, and each plan carries the
   * code we hand back at purchase — no price matching anywhere.
   */
  async listBillPlans(
    service: "data" | "cabletv",
    billerCode: string,
  ): Promise<ProviderBillPlan[]> {
    if (service === "data") {
      const bundles = await this.req<Array<{ name: string; price: number; code: string }>>(
        `/bills/data/bundle/${billerCode}`,
      );
      return bundles.map((b) => ({ code: b.code, name: b.name, amountMinor: b.price }));
    }

    // Cable plans are grouped by bouquet; each `payment_options` entry is one
    // duration (1 month, 2 months, ...) with its own subscription id and price.
    const bouquets = await this.req<
      Array<{
        title: string;
        payment_options?: Array<{
          subscription_id: string;
          price: number;
          duration?: { value: number; type: string };
        }>;
      }>
    >(`/bills/cable/subscriptions/${billerCode}`);

    return bouquets.flatMap((b) =>
      (b.payment_options ?? []).map((o) => ({
        code: o.subscription_id,
        name: o.duration && o.duration.value > 1
          ? `${b.title} · ${o.duration.value} ${o.duration.type === "monthly" ? "months" : o.duration.type}`
          : b.title,
        amountMinor: o.price,
      })),
    );
  }

  private async payData(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const r = await this.req<{ id: string; status: string }>("/bills/data", "POST", {
      identifier: this.identifier(input),
      bundle_identifier: this.planCode(input),
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
    const r = await this.req<{ id: string; status: string }>("/bills/cable", "POST", {
      identifier: this.identifier(input),
      serial_number: input.customer,
      amount: kobo,
      subscription_id: this.planCode(input),
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
   * Open the user's dedicated NGN collection account (a permanent NUBAN).
   *
   * Maplerad hangs a collection account off a *customer*, so the caller must
   * have enrolled one first and passed its id — see lib/virtualAccounts.ts.
   * Without it there is nothing to attach the account to, and Maplerad's own
   * error for the missing field is not one an operator can act on, so we say
   * plainly what is missing instead.
   *
   * Money paid into the returned NUBAN lands in the business wallet and arrives
   * back as a `collection.successful` webhook, which is what actually credits
   * the user (app/api/webhooks/maplerad/route.ts). Creating the account here
   * and crediting there are two halves of one feature: neither is any use alone.
   */
  async createVirtualAccount(i: CreateVirtualAccountInput): Promise<VirtualAccountResult> {
    if (!i.mapleradCustomerId) {
      throw new Error(DEPOSITS_UNAVAILABLE);
    }

    const acct = await this.req<{
      id: string;
      account_number: string;
      bank_name?: string;
      bank_code?: string;
      account_name?: string;
    }>("/collections/virtual-account", "POST", {
      customer_id: i.mapleradCustomerId,
      currency: "NGN",
      // Our own reference, echoed back on the collection webhook where
      // available — a second way to place a payment if account matching ever
      // comes up short.
      reference: i.txRef,
    });

    if (!acct?.account_number) {
      throw new Error(
        "Maplerad created a collection account but returned no account number",
      );
    }

    return {
      accountNumber: acct.account_number,
      bankName: acct.bank_name ?? "Maplerad",
      bankCode: acct.bank_code,
      providerRef: acct.id,
      // Always permanent: a static account is created once per user and reused
      // forever, which is the whole reason it is tied to a KYC'd customer.
      permanent: true,
    };
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
