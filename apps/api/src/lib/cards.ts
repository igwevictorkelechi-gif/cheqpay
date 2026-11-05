import { prisma } from "@cheqpay/db";
import type { CardStorePort, IssuingEventData } from "./maplerad/issuing";
import { refundCardIssueFee } from "./cardFunding";
import { finalizeDevCard } from "./devapi/cards";
import { alertOpsOnce } from "./opsAlert";

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
    const matched = await prisma.card
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
        return null;
      });

    // No app card has this reference: it may be one a developer issued through the API.
    if (matched && matched.count === 0) {
      await finalizeDevCard({ reference, cardId, status, raw: data as Record<string, unknown> }).catch((err) => {
        console.error("[cards] developer card finalize failed", { reference, error: String(err) });
      });
      return;
    }

    // Maplerad said no: the card will never exist, so its price goes back.
    // Only on an explicit failure — an unknown or pending status keeps the charge.
    if (/^(FAILED|FAILURE|DECLINED|REJECTED|ERROR)$/i.test(status)) {
      const refunded = await refundCardIssueFee({ reference })
        .then(() => true)
        .catch((err) => {
          console.error("[cards] refunding the card price failed — refund by hand", {
            reference,
            error: String(err),
          });
          return false;
        });
      await recordIssueFailure(reference, data, refunded);
    }
  },
};

/**
 * Keep why Maplerad refused a card (e.g. a selfie that didn't match the
 * passport) and the link the customer can retry verification with. Never
 * throws: a missing audit row must not 500 the webhook.
 */
async function recordIssueFailure(reference: string, raw: Record<string, unknown>, refunded: boolean): Promise<void> {
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
  const reason = str(raw.reason);
  const card = await prisma.card
    .findUnique({ where: { reference }, select: { id: true, userId: true } })
    .catch(() => null);
  await prisma.auditLog
    .create({
      data: {
        userId: card?.userId ?? null,
        action: "card.issue_failed",
        resourceType: "Card",
        resourceId: card?.id ?? null,
        details: {
          via: "webhook",
          reference,
          reason: reason ?? null,
          verificationLink: str(raw.verification_link) ?? null,
          linkExpiresAt: str(raw.link_expire_at) ?? null,
          refunded,
        },
      },
    })
    .catch(() => undefined);
  await alertOpsOnce("card-issue-failed-webhook", `Card issuing failed: ${reason ?? "no reason given"}`, {
    reference,
    ...(card ? { card: card.id } : {}),
    refunded: refunded ? "yes" : "no — refund by hand",
  });
}
