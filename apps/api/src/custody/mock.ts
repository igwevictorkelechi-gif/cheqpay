import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Asset, Network } from "@cheqpay/db";
import type { CustodyProvider, DepositAddress, IncomingDeposit } from "./types";

/**
 * Deterministic in-memory custody provider for development and tests.
 * Generates stable fake addresses and verifies webhook HMACs exactly like a
 * real provider would, so the deposit pipeline can be exercised end-to-end
 * without any external dependency or live key.
 */
export class MockCustodyProvider implements CustodyProvider {
  readonly name = "mock";

  constructor(private readonly webhookSecret = "mock-webhook-secret") {}

  async createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
  }): Promise<DepositAddress> {
    const seed = `${input.userId}:${input.asset}:${input.network}`;
    const hash = createHash("sha256").update(seed).digest("hex");
    const prefix = input.network === Network.BITCOIN ? "bc1mock" : "Tmock";
    return {
      address: `${prefix}${hash.slice(0, 34)}`,
      custodyRef: `mock-va-${hash.slice(0, 16)}`,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.webhookSecret)
      .update(rawBody)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDepositEvent(payload: unknown): IncomingDeposit | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    if (
      typeof p.eventId !== "string" ||
      typeof p.address !== "string" ||
      typeof p.amount !== "string" ||
      typeof p.txHash !== "string" ||
      typeof p.asset !== "string" ||
      typeof p.network !== "string"
    ) {
      return null;
    }
    if (!(p.asset in Asset) || !(p.network in Network)) return null;
    return {
      eventId: p.eventId,
      address: p.address,
      amount: p.amount,
      txHash: p.txHash,
      asset: p.asset as Asset,
      network: p.network as Network,
    };
  }

  /** Test helper: sign a body the way the provider would. */
  sign(rawBody: string): string {
    return createHmac("sha512", this.webhookSecret).update(rawBody).digest("base64");
  }
}
