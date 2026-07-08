import { createHmac, timingSafeEqual } from "node:crypto";
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

const PS_BASE = "https://api.paystack.co";

/**
 * Paystack payment rail. Dedicated Virtual Accounts (DVA) provide each user a
 * permanent NUBAN; transfers pay out to bank accounts; webhooks are HMAC-SHA512
 * of the raw body with the secret key (x-paystack-signature header).
 *
 * Paystack amounts are integer KOBO on the wire; this adapter converts to/from
 * the decimal-NGN strings the rest of the backend uses.
 *
 * Bills are NOT offered by Paystack — bill payments stay on Flutterwave via
 * getBillsProvider(); payBill here throws if ever reached.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";

  constructor(private readonly secretKey: string) {}

  private headers() {
    return {
      authorization: `Bearer ${this.secretKey}`,
      "content-type": "application/json",
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseChargeEvent(payload: unknown): NgnChargeEvent | null {
    if (!isRecord(payload) || payload.event !== "charge.success") return null;
    const data = payload.data;
    if (!isRecord(data)) return null;
    const id = data.id;
    const reference = data.reference;
    const amountKobo = data.amount;
    const currency = data.currency;
    if (
      (typeof id !== "number" && typeof id !== "string") ||
      typeof reference !== "string" ||
      typeof amountKobo !== "number" ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const customer = isRecord(data.customer) ? data.customer : undefined;
    return {
      eventId: `charge:${id}`,
      txRef: reference,
      amount: (amountKobo / 100).toFixed(2),
      currency,
      status: "successful", // Paystack only emits charge.success for settled charges
      customerEmail:
        customer && typeof customer.email === "string" ? customer.email : undefined,
    };
  }

  parseTransferEvent(payload: unknown): NgnTransferEvent | null {
    if (!isRecord(payload)) return null;
    const event = payload.event;
    if (
      event !== "transfer.success" &&
      event !== "transfer.failed" &&
      event !== "transfer.reversed"
    ) {
      return null;
    }
    const data = payload.data;
    if (!isRecord(data)) return null;
    const reference = data.reference;
    const id = data.id;
    if (typeof reference !== "string" || (typeof id !== "number" && typeof id !== "string")) {
      return null;
    }
    return {
      eventId: `transfer:${id}:${event}`,
      reference,
      status: event === "transfer.success" ? "successful" : "failed",
    };
  }

  async initiateTransfer(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    reference: string;
    narration?: string;
  }): Promise<TransferResult> {
    // Paystack needs a transfer recipient first. Resolve the holder name so
    // the recipient record carries the real account name.
    let recipientName = "CheqPay Customer";
    try {
      const { accountName } = await this.resolveBankAccount({
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      });
      recipientName = accountName;
    } catch {
      /* name enquiry failed — proceed with placeholder */
    }

    const recRes = await fetch(`${PS_BASE}/transferrecipient`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        type: "nuban",
        name: recipientName,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: "NGN",
      }),
    });
    const recJson = (await recRes.json().catch(() => ({}))) as {
      status?: boolean;
      data?: { recipient_code?: string };
    };
    if (!recRes.ok || !recJson.status || !recJson.data?.recipient_code) {
      throw new Error(`Paystack recipient creation failed: ${recRes.status}`);
    }

    const res = await fetch(`${PS_BASE}/transfer`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(Number(input.amount) * 100), // kobo
        recipient: recJson.data.recipient_code,
        reference: input.reference,
        reason: input.narration ?? "CheqPay payout",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      data?: { id?: number | string; status?: string; transfer_code?: string };
    };
    if (!res.ok || !json.status || !json.data) {
      throw new Error(`Paystack transfer failed: ${res.status}`);
    }
    const raw = (json.data.status ?? "pending").toLowerCase();
    const status: TransferResult["status"] =
      raw === "success"
        ? "successful"
        : raw === "failed"
          ? "failed"
          : // pending / queued / otp → in flight; webhook finalizes
            "pending";
    return {
      providerRef: String(json.data.transfer_code ?? json.data.id ?? input.reference),
      status,
    };
  }

  async createVirtualAccount(
    input: CreateVirtualAccountInput
  ): Promise<VirtualAccountResult> {
    // 1) Create (or reuse) the customer.
    const custRes = await fetch(`${PS_BASE}/customer`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone,
      }),
    });
    const custJson = (await custRes.json().catch(() => ({}))) as {
      status?: boolean;
      data?: { customer_code?: string };
    };
    if (!custRes.ok || !custJson.status || !custJson.data?.customer_code) {
      throw new Error(`Paystack customer creation failed: ${custRes.status}`);
    }
    const customerCode = custJson.data.customer_code;

    // 2) Best-effort BVN validation (required by some banks before a DVA can
    // be assigned; harmless if the account is already validated).
    if (input.bvn) {
      await fetch(`${PS_BASE}/customer/${customerCode}/identification`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          country: "NG",
          type: "bvn",
          bvn: input.bvn,
          first_name: input.firstName,
          last_name: input.lastName,
        }),
      }).catch(() => undefined);
    }

    // 3) Assign the dedicated NUBAN.
    const dvaRes = await fetch(`${PS_BASE}/dedicated_account`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: process.env.PAYSTACK_PREFERRED_BANK || "wema-bank",
      }),
    });
    const dvaJson = (await dvaRes.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        id?: number | string;
        account_number?: string;
        bank?: { name?: string; slug?: string };
      };
    };
    if (!dvaRes.ok || !dvaJson.status || !dvaJson.data?.account_number) {
      throw new Error(
        `Paystack dedicated account failed: ${dvaRes.status} ${dvaJson.message ?? ""}`.trim()
      );
    }
    return {
      accountNumber: dvaJson.data.account_number,
      bankName: dvaJson.data.bank?.name ?? "Wema Bank",
      providerRef: String(dvaJson.data.id ?? customerCode),
      // Paystack DVAs are permanent by nature.
      permanent: true,
    };
  }

  async resolveBankAccount(
    input: ResolveAccountInput
  ): Promise<ResolveAccountResult> {
    const url =
      `${PS_BASE}/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}` +
      `&bank_code=${encodeURIComponent(input.bankCode)}`;
    const res = await fetch(url, { headers: this.headers() });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      data?: { account_name?: string };
    };
    if (!res.ok || !json.status || !json.data?.account_name) {
      throw new Error(`Paystack account resolution failed: ${res.status}`);
    }
    return { accountName: json.data.account_name };
  }

  async listBanks(): Promise<Bank[]> {
    const res = await fetch(`${PS_BASE}/bank?currency=NGN&perPage=100`, {
      headers: this.headers(),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      data?: Array<{ code?: string; name?: string }>;
    };
    if (!res.ok || !json.status || !Array.isArray(json.data)) {
      throw new Error(`Paystack bank list failed: ${res.status}`);
    }
    return json.data
      .filter((b): b is { code: string; name: string } => !!b.code && !!b.name)
      .map((b) => ({ code: String(b.code), name: String(b.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async validateBillCustomer(_input: BillValidateInput): Promise<BillValidateResult> {
    // Bills route through getBillsProvider() (Flutterwave); never Paystack.
    return { valid: false };
  }

  async payBill(_input: BillPayInput): Promise<BillPayResult> {
    throw new BillPaymentError(
      "Bill payments are not available on the Paystack rail",
      "Bills are processed via Flutterwave"
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
