// apps/api/src/payments/maplerad.ts
//
// Maplerad as a BILLS-ONLY payment rail, implementing the existing
// PaymentProvider interface (see ./types). It handles data, electricity and
// cable TV. Airtime / betting / food are NOT offered by Maplerad's bills API,
// so those methods throw and the caller (getBillsProvider) should keep
// Flutterwave for them. The money-in/out rail (virtual accounts, payouts,
// name enquiry) stays on Paystack/Flutterwave — those methods here throw a
// clear "bills-only" error and are never reached while Maplerad is only the
// BILLS_PROVIDER.
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

const BILLS_ONLY = "Maplerad is configured as a bills-only rail; use PAYMENT_PROVIDER (Paystack/Flutterwave) for this operation.";

/** NGN decimal string -> kobo integer. "100" -> 10000. */
function toKobo(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

/**
 * Map a Flutterwave biller code (used in our catalog) to a brand token we can
 * match against Maplerad's biller identifiers at runtime. Extend as the catalog
 * grows. Airtime/betting/food have no Maplerad equivalent and are omitted.
 */
const FLW_TO_BRAND: Record<string, string> = {
  // data networks
  BIL099: "mtn",
  BIL100: "airtel",
  BIL102: "glo",
  BIL103: "9mobile",
  // electricity discos
  BIL113: "ikeja",
  BIL112: "eko",
  BIL115: "abuja",
  BIL117: "port", // Port Harcourt
  BIL116: "kano",
  BIL118: "ibadan",
  // cable
  BIL121: "dstv",
  BIL122: "gotv",
  BIL123: "startimes",
};

interface MapleradBiller {
  name: string;
  identifier: string;
  commission?: number;
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

  private async billers(type: "data" | "cable" | "electricity"): Promise<MapleradBiller[]> {
    return this.req<MapleradBiller[]>(`/bills/${type}/billers/NG`);
  }

  /** Find the Maplerad biller whose identifier matches a catalog brand. */
  private async matchBiller(
    type: "data" | "cable" | "electricity",
    flwBillerCode: string | undefined,
  ): Promise<MapleradBiller> {
    const brand = flwBillerCode ? FLW_TO_BRAND[flwBillerCode] : undefined;
    if (!brand) {
      throw new BillPaymentError("Unmapped biller for Maplerad rail", `No Maplerad mapping for ${flwBillerCode ?? "unknown biller"}`);
    }
    const list = await this.billers(type);
    const hit =
      list.find((b) => b.identifier.toLowerCase().includes(brand)) ??
      list.find((b) => b.name.toLowerCase().includes(brand));
    if (!hit) {
      throw new BillPaymentError("Biller not available on Maplerad", `${brand} not found in Maplerad ${type} billers`);
    }
    return hit;
  }

  // ---- Bills (SUPPORTED) --------------------------------------------------

  async payBill(input: BillPayInput): Promise<BillPayResult> {
    const kobo = toKobo(input.amount);
    if (!Number.isInteger(kobo) || kobo <= 0) {
      throw new BillPaymentError("Invalid bill amount", "Amount must be a positive number");
    }

    switch (input.service) {
      case "data":
        return this.payData(input, kobo);
      case "electricity":
        return this.payElectricity(input, kobo);
      case "cabletv":
        return this.payCable(input, kobo);
      case "airtime":
      case "betting":
      case "food":
      default:
        throw new BillPaymentError(
          `${input.service} is not supported on the Maplerad rail`,
          `Maplerad bills does not offer ${input.service}; route it to Flutterwave.`,
        );
    }
  }

  private async payData(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const biller = await this.matchBiller("data", input.flwBillerCode);
    const bundles = await this.req<Array<{ name: string; price: number; code: string }>>(
      `/bills/data/bundle/${biller.identifier}`,
    );
    // Match the plan by price (kobo). Require an exact match to avoid selling
    // the wrong bundle; if none matches, the catalog plan needs aligning.
    const bundle = bundles.find((b) => b.price === kobo);
    if (!bundle) {
      throw new BillPaymentError(
        "No matching data bundle",
        `No Maplerad ${biller.name} bundle priced at ₦${(kobo / 100).toFixed(2)}. Align the catalog plan to a Maplerad bundle.`,
      );
    }
    const r = await this.req<{ id: string; status: string }>("/bills/data", "POST", {
      identifier: biller.identifier,
      bundle_identifier: bundle.code,
      phone_number: input.customer,
      amount: kobo,
    });
    return { providerRef: r.id, status: normalizeStatus(r.status) };
  }

  private async payElectricity(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const biller = await this.matchBiller("electricity", input.flwBillerCode);
    const r = await this.req<{ id: string; status: string; token?: string }>(
      "/bills/electricity",
      "POST",
      {
        meter_number: input.customer,
        identifier: biller.identifier,
        amount: kobo,
        phone_number: input.customer,
      },
    );
    return { providerRef: r.id, status: normalizeStatus(r.status), token: r.token ?? null };
  }

  private async payCable(input: BillPayInput, kobo: number): Promise<BillPayResult> {
    const biller = await this.matchBiller("cable", input.flwBillerCode);
    // Maplerad cable needs a subscription_id; resolve it by matching the plan price.
    const groups = await this.req<Array<{ subscription_plans: Array<{ subscription_id: string; price: number }> }>>(
      `/bills/cable/subscriptions/${biller.identifier}`,
    );
    const plan = groups
      .flatMap((g) => g.subscription_plans)
      .find((p) => p.price === kobo);
    if (!plan) {
      throw new BillPaymentError(
        "No matching cable plan",
        `No Maplerad ${biller.name} plan priced at ₦${(kobo / 100).toFixed(2)}. Align the catalog plan to a Maplerad subscription.`,
      );
    }
    const r = await this.req<{ id: string; status: string }>("/bills/cable", "POST", {
      identifier: biller.identifier,
      serial_number: input.customer,
      amount: kobo,
      subscription_id: plan.subscription_id,
    });
    return { providerRef: r.id, status: normalizeStatus(r.status) };
  }

  async validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult> {
    // Only electricity meters can be resolved on Maplerad. Cable smartcard
    // validation isn't exposed, so we optimistically pass it (the purchase
    // call will reject a bad smartcard).
    const brand = input.flwBillerCode ? FLW_TO_BRAND[input.flwBillerCode] : undefined;
    if (!brand) return { valid: true };
    try {
      const biller = await this.matchBiller("electricity", input.flwBillerCode);
      const r = await this.req<{ name: string }>("/bills/electricity/resolve-account", "POST", {
        meter_number: input.customer,
        identifier: biller.identifier,
      });
      return { valid: Boolean(r.name), customerName: r.name };
    } catch {
      // Not an electricity biller (or resolve unsupported) — don't block.
      return { valid: true };
    }
  }

  // ---- Money-in/out (NOT on this rail) ------------------------------------

  async listBanks(): Promise<Bank[]> {
    // Institutions are available on Maplerad, but payouts run on the main rail.
    const banks = await this.req<Array<{ name: string; code: string }>>(
      "/institutions?type=NUBAN&country=NG&page=1&page_size=100",
    );
    return banks.map((b) => ({ code: b.code, name: b.name }));
  }

  verifyWebhookSignature(): boolean {
    // Maplerad uses Svix (svix-id/svix-timestamp/svix-signature) — a different
    // shape than this single-signature interface. If you later run collections
    // on Maplerad, handle its webhooks in a dedicated route, not here.
    throw new Error(BILLS_ONLY);
  }
  parseChargeEvent(): NgnChargeEvent | null { return null; }
  parseTransferEvent(): NgnTransferEvent | null { return null; }
  async initiateTransfer(): Promise<TransferResult> { throw new Error(BILLS_ONLY); }
  async createVirtualAccount(_i: CreateVirtualAccountInput): Promise<VirtualAccountResult> { throw new Error(BILLS_ONLY); }
  async resolveBankAccount(_i: ResolveAccountInput): Promise<ResolveAccountResult> { throw new Error(BILLS_ONLY); }
}

function normalizeStatus(s: string): "successful" | "pending" | "failed" {
  const u = (s || "").toUpperCase();
  if (u === "SUCCESS" || u === "SUCCESSFUL" || u === "COMPLETED") return "successful";
  if (u === "FAILED" || u === "DECLINED") return "failed";
  return "pending";
}
