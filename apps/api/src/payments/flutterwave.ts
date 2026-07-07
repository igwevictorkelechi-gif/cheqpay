import { timingSafeEqual } from "node:crypto";
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

const FLW_BASE = "https://api.flutterwave.com/v3";

/**
 * Flutterwave payment rail. Webhooks are authenticated by comparing the
 * `verif-hash` header to the configured secret hash (Flutterwave's scheme).
 *
 * NOTE: HTTP calls (transfers, virtual accounts, resolution) are provider-
 * correct in shape but NOT exercised against the live API in this build.
 * Validate against current Flutterwave docs before enabling in production.
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave";

  constructor(
    private readonly secretKey: string,
    private readonly webhookHash: string
  ) {}

  verifyWebhookSignature(_rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(this.webhookHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseChargeEvent(payload: unknown): NgnChargeEvent | null {
    if (!isRecord(payload)) return null;
    if (payload.event !== "charge.completed") return null;
    const data = payload.data;
    if (!isRecord(data)) return null;
    const amount = data.amount;
    const txRef = data.tx_ref;
    const id = data.id;
    const currency = data.currency;
    if (
      (typeof amount !== "number" && typeof amount !== "string") ||
      typeof txRef !== "string" ||
      (typeof id !== "number" && typeof id !== "string") ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const customer = isRecord(data.customer) ? data.customer : undefined;
    return {
      eventId: `charge:${id}`,
      txRef,
      amount: String(amount),
      currency,
      status: data.status === "successful" ? "successful" : "failed",
      customerEmail:
        customer && typeof customer.email === "string" ? customer.email : undefined,
    };
  }

  parseTransferEvent(payload: unknown): NgnTransferEvent | null {
    if (!isRecord(payload)) return null;
    if (payload.event !== "transfer.completed") return null;
    const data = payload.data;
    if (!isRecord(data)) return null;
    const reference = data.reference;
    const id = data.id;
    if (typeof reference !== "string" || (typeof id !== "number" && typeof id !== "string")) {
      return null;
    }
    const status =
      data.status === "SUCCESSFUL"
        ? "successful"
        : data.status === "FAILED"
          ? "failed"
          : "pending";
    return { eventId: `transfer:${id}`, reference, status };
  }

  async initiateTransfer(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    reference: string;
    narration?: string;
  }): Promise<TransferResult> {
    const res = await fetch(`${FLW_BASE}/transfers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_bank: input.bankCode,
        account_number: input.accountNumber,
        amount: Number(input.amount),
        currency: "NGN",
        reference: input.reference,
        narration: input.narration ?? "CheqPay payout",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: number | string; status?: string };
    };
    if (!res.ok || !json.data) {
      throw new Error(`Flutterwave transfer failed: ${res.status}`);
    }
    const status = (json.data.status ?? "NEW").toLowerCase();
    return {
      providerRef: String(json.data.id ?? input.reference),
      status: (["new", "pending", "successful", "failed"].includes(status)
        ? status
        : "new") as TransferResult["status"],
    };
  }

  async createVirtualAccount(
    input: CreateVirtualAccountInput
  ): Promise<VirtualAccountResult> {
    const res = await fetch(`${FLW_BASE}/virtual-account-numbers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        is_permanent: input.permanent,
        bvn: input.bvn,
        tx_ref: input.txRef,
        phonenumber: input.phone,
        firstname: input.firstName,
        lastname: input.lastName,
        narration: input.narration ?? `${input.firstName} ${input.lastName}`,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      data?: {
        account_number?: string;
        bank_name?: string;
        order_ref?: string;
        flw_ref?: string;
      };
    };
    if (!res.ok || json.status !== "success" || !json.data?.account_number) {
      throw new Error(`Flutterwave virtual account creation failed: ${res.status}`);
    }
    return {
      accountNumber: json.data.account_number,
      bankName: json.data.bank_name ?? "Flutterwave",
      providerRef: String(json.data.order_ref ?? json.data.flw_ref ?? input.txRef),
      permanent: input.permanent,
    };
  }

  async resolveBankAccount(
    input: ResolveAccountInput
  ): Promise<ResolveAccountResult> {
    const res = await fetch(`${FLW_BASE}/accounts/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_number: input.accountNumber,
        account_bank: input.bankCode,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      data?: { account_name?: string };
    };
    if (!res.ok || json.status !== "success" || !json.data?.account_name) {
      throw new Error(`Flutterwave account resolution failed: ${res.status}`);
    }
    return { accountName: json.data.account_name };
  }

  async listBanks(): Promise<Bank[]> {
    const res = await fetch(`${FLW_BASE}/banks/NG`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      data?: Array<{ code?: string; name?: string }>;
    };
    if (!res.ok || json.status !== "success" || !Array.isArray(json.data)) {
      throw new Error(`Flutterwave bank list failed: ${res.status}`);
    }
    return json.data
      .filter((b): b is { code: string; name: string } => !!b.code && !!b.name)
      .map((b) => ({ code: String(b.code), name: String(b.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult> {
    // No codes to validate against → treat as a non-validated service.
    if (!input.flwItemCode || !input.flwBillerCode) return { valid: true };
    const url =
      `${FLW_BASE}/bill-items/${encodeURIComponent(input.flwItemCode)}/validate` +
      `?code=${encodeURIComponent(input.flwBillerCode)}` +
      `&customer=${encodeURIComponent(input.customer)}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      data?: { name?: string; customer?: string };
    };
    if (!res.ok || json.status !== "success" || !json.data) {
      return { valid: false };
    }
    return { valid: true, customerName: json.data.name };
  }

  async payBill(input: BillPayInput): Promise<BillPayResult> {
    // Flutterwave pays a bill against a specific biller ITEM (e.g. a disco's
    // "prepaid" product, a data bundle, a cable package). Airtime is the one
    // service that also works via the simple type-based /v3/bills endpoint.
    //
    // Item codes + amounts are provider-managed and change over time, so we
    // resolve a valid item code live from Flutterwave rather than hard-coding
    // it. Falls back to /v3/bills (type-based) only when we can't resolve one.
    let itemCode = input.flwItemCode;
    if (!itemCode && input.flwBillerCode && input.service !== "airtime") {
      itemCode = await this.resolveItemCode(
        input.flwBillerCode,
        input.service,
        input.amount
      );
    }

    const useItem = !!(input.flwBillerCode && itemCode);
    const url = useItem
      ? `${FLW_BASE}/billers/${input.flwBillerCode}/items/${itemCode}/payment`
      : `${FLW_BASE}/bills`;
    const body = useItem
      ? {
          country: "NG",
          customer_id: input.customer,
          amount: Number(input.amount),
          reference: input.reference,
        }
      : {
          country: "NG",
          customer: input.customer,
          amount: Number(input.amount),
          type: input.flwType,
          reference: input.reference,
          recurrence: "ONCE",
        };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || json.status !== "success" || !json.data) {
      // Surface Flutterwave's own reason (safe: it carries no credentials) so
      // the app can tell the user *why* — e.g. insufficient Flutterwave
      // balance, biller unavailable, invalid customer.
      console.error("[flutterwave] payBill failed", {
        endpoint: useItem ? "biller-item" : "bills",
        billerCode: input.flwBillerCode,
        itemCode,
        httpStatus: res.status,
        providerStatus: json.status,
        providerMessage: json.message,
      });
      throw new BillPaymentError(
        `Flutterwave bill payment failed (HTTP ${res.status})`,
        typeof json.message === "string" ? json.message : undefined,
        res.status
      );
    }
    const d = json.data;
    const raw = String(d.status ?? "pending").toLowerCase();
    const status: BillPayResult["status"] =
      raw.includes("success") || raw.includes("completed")
        ? "successful"
        : raw.includes("fail")
          ? "failed"
          : "pending";
    const providerRef = String(d.reference ?? d.flw_ref ?? d.tx_ref ?? input.reference);

    // Prepaid services (electricity) issue a recharge token — surface it. The
    // token can arrive inline or only on the status requery.
    let token = extractBillToken(d);
    if (!token && status === "successful") {
      token = await this.requeryBillToken(input.reference);
    }
    return { providerRef, status, token };
  }

  /**
   * Resolve a valid Flutterwave item code for a biller. For fixed-price
   * services (data bundles, cable packages) we match the item whose amount
   * equals the plan amount; for variable services (electricity) we prefer the
   * "prepaid" item, falling back to the first item. Returns undefined if the
   * biller has no items or the lookup fails — the caller then uses /v3/bills.
   */
  private async resolveItemCode(
    billerCode: string,
    service: string,
    amount: string
  ): Promise<string | undefined> {
    try {
      const res = await fetch(`${FLW_BASE}/billers/${billerCode}/items`, {
        headers: { authorization: `Bearer ${this.secretKey}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        data?: Array<Record<string, unknown>>;
      };
      if (!res.ok || json.status !== "success" || !Array.isArray(json.data) || json.data.length === 0) {
        console.error("[flutterwave] biller items lookup failed", {
          billerCode,
          httpStatus: res.status,
          providerStatus: json.status,
        });
        return undefined;
      }
      const items = json.data;
      const codeOf = (it: Record<string, unknown>): string | undefined => {
        const c = it.item_code ?? it.itemCode ?? it.biller_code;
        return typeof c === "string" && c ? c : undefined;
      };

      // Fixed-price services: match the item priced at the plan amount.
      const want = Number(amount);
      const byAmount = items.find((it) => Number(it.amount) === want);
      if (byAmount) return codeOf(byAmount);

      // Variable services (electricity): prefer a prepaid item.
      if (service === "electricity") {
        const prepaid = items.find((it) =>
          String(it.name ?? "").toLowerCase().includes("prepaid")
        );
        if (prepaid) return codeOf(prepaid);
      }

      // Otherwise a variable/first item.
      const variable = items.find(
        (it) => it.is_amount_fixed === 0 || it.is_amount_fixed === false || it.amount === 0
      );
      return codeOf(variable ?? items[0]);
    } catch (err) {
      console.error("[flutterwave] biller items lookup error", billerCode, err);
      return undefined;
    }
  }

  /** Requery a bill payment to pick up the prepaid token once processed. */
  private async requeryBillToken(reference: string): Promise<string | null> {
    try {
      const res = await fetch(`${FLW_BASE}/bills/${reference}`, {
        headers: { authorization: `Bearer ${this.secretKey}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        data?: Record<string, unknown>;
      };
      if (json.status !== "success" || !json.data) return null;
      return extractBillToken(json.data);
    } catch {
      return null;
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/** Pull a prepaid token out of the varied shapes FLW bill responses use. */
function extractBillToken(d: Record<string, unknown>): string | null {
  const direct = d.token ?? d.recharge_token ?? d.rechargeToken;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const extra = d.extra;
  if (typeof extra === "string" && extra.trim()) return extra.trim();
  if (isRecord(extra)) {
    const t = extra.token ?? extra.recharge_token;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}
