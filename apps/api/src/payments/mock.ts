import { createHash, timingSafeEqual } from "node:crypto";
import type {
  BillPayInput,
  BillPayResult,
  BillValidateInput,
  BillValidateResult,
  NgnChargeEvent,
  NgnTransferEvent,
  PaymentProvider,
  TransferResult,
} from "./types";

/**
 * Deterministic PSP for development/tests. Verifies a static webhook secret
 * (Flutterwave-style equality), parses a normalized event shape, and returns
 * deterministic transfer references.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  constructor(private readonly webhookSecret = "mock-psp-secret") {}

  verifyWebhookSignature(_rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(this.webhookSecret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseChargeEvent(payload: unknown): NgnChargeEvent | null {
    if (!isRecord(payload) || payload.type !== "charge") return null;
    const { eventId, txRef, amount, currency, status } = payload;
    if (
      typeof eventId !== "string" ||
      typeof txRef !== "string" ||
      typeof amount !== "string" ||
      typeof currency !== "string" ||
      !isStatus(status)
    ) {
      return null;
    }
    return {
      eventId,
      txRef,
      amount,
      currency,
      status,
      customerEmail:
        typeof payload.customerEmail === "string" ? payload.customerEmail : undefined,
    };
  }

  parseTransferEvent(payload: unknown): NgnTransferEvent | null {
    if (!isRecord(payload) || payload.type !== "transfer") return null;
    const { eventId, reference, status } = payload;
    if (
      typeof eventId !== "string" ||
      typeof reference !== "string" ||
      !isStatus(status)
    ) {
      return null;
    }
    return { eventId, reference, status };
  }

  async initiateTransfer(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    reference: string;
  }): Promise<TransferResult> {
    const providerRef =
      "mock-tr-" +
      createHash("sha256").update(input.reference).digest("hex").slice(0, 16);
    return { providerRef, status: "new" };
  }

  async validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult> {
    // Deterministic fake customer name derived from the identifier.
    const NAMES = ["Chinedu Okafor", "Aisha Bello", "Tunde Adeyemi", "Ngozi Eze"];
    const idx =
      parseInt(createHash("sha256").update(input.customer).digest("hex").slice(0, 8), 16) %
      NAMES.length;
    return { valid: true, customerName: NAMES[idx] };
  }

  async payBill(input: BillPayInput): Promise<BillPayResult> {
    const providerRef =
      "mock-bill-" +
      createHash("sha256").update(input.reference).digest("hex").slice(0, 16);
    return { providerRef, status: "successful" };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isStatus(v: unknown): v is NgnChargeEvent["status"] {
  return v === "successful" || v === "failed" || v === "pending";
}
