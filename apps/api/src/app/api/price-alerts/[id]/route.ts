import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensurePriceAlertsSchema } from "@/lib/ensurePriceAlerts";

export const dynamic = "force-dynamic";

/** Delete one of the user's price alerts (scoped to the owner). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("price_alerts");
    await ensurePriceAlertsSchema();
    const { id } = await params;
    await prisma.priceAlert.deleteMany({ where: { id, userId: auth.id } });
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Re-arm or pause an alert. One-shot alerts go inactive after firing; sending
 * `{ active: true }` re-arms the same target without recreating it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("price_alerts");
    await ensurePriceAlertsSchema();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { active?: unknown };
    const active = body.active === true;
    // Scoped update: re-arm clears the last-fired marker so it can trigger again.
    await prisma.priceAlert.updateMany({
      where: { id, userId: auth.id },
      data: { active, ...(active ? { lastTriggeredAt: null } : {}) },
    });
    return jsonOk({ updated: true, active });
  } catch (err) {
    return toErrorResponse(err);
  }
}
