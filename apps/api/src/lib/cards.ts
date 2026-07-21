import { prisma } from "@cheqpay/db";
import type { CardStorePort, IssuingEventData } from "./maplerad/issuing";

/**
 * Card issuing is gated on Maplerad being configured (the same secret key the
 * NGN rail uses). The admin `virtual_cards` feature flag is the real on/off
 * switch and defaults OFF (see lib/features.ts) — this just tells the client UI
 * whether the provider could serve a card at all, so it can show "coming soon".
 */
export function cardsAvailable(): boolean {
  return Boolean(process.env.MAPLERAD_SECRET_KEY);
}

/** Safe "•••• 1234" from a full or already-masked PAN. */
export function maskPan(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 4) return null;
  return `•••• ${raw.replace(/\D/g, "").slice(-4)}`;
}

/**
 * Reconciles the async issuing webhook back to our `cards` table. Matched by the
 * creation `reference` we stored when the card was requested.
 */
export const cardStore: CardStorePort = {
  async finalizeCard({ reference, cardId, status, raw }) {
    const data = raw as IssuingEventData & { masked_pan?: string; brand?: string };
    const success = status.toUpperCase() === "SUCCESS" || status.toUpperCase() === "SUCCESSFUL";
    await prisma.card
      .updateMany({
        where: { reference },
        data: {
          providerCardId: cardId ?? undefined,
          status: success ? "active" : status.toLowerCase(),
          maskedPan: maskPan(data.masked_pan) ?? undefined,
          brand: typeof data.brand === "string" ? data.brand : undefined,
        },
      })
      .catch((err) => {
        // Never 500 the webhook over a reconciliation miss — Maplerad would
        // retry forever. Log loudly so a stuck pending card is visible.
        console.error("[cards] finalizeCard failed", { reference, error: String(err) });
      });
  },
};
