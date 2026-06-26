import { timingSafeEqual } from "node:crypto";
import type {
  NgnChargeEvent,
  NgnTransferEvent,
  PaymentProvider,
  TransferResult,
} from "./types";

const FLW_BASE = "https://api.flutterwave.com/v3";

/**
 * Flutterwave payment rail. Webhooks are authenticated by comparing the
 * `verif-hash` header to the configured secret hash (Flutterwave's scheme).
 *
 * NOTE: HTTP calls (transfers) are provider-correct in shape but NOT exercised
 * against the live API in this build. Validate against current Flutterwave docs
 * before enabling in production.
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
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
