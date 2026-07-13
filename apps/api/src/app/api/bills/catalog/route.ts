import { prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { BILL_CATALOG } from "@/lib/bills";

export const dynamic = "force-dynamic";

/** Public catalog of bill services, billers and plans the app offers. */
export async function GET() {
  try {
    // Admin-uploaded logos override the default wordmark tiles.
    const assets = await prisma.billerAsset.findMany();
    const logoById = new Map(assets.map((a) => [a.billerId, a.logo]));

    // Strip provider-internal biller codes from the public payload.
    const services = BILL_CATALOG.map((s) => ({
      service: s.service,
      label: s.label,
      emoji: s.emoji,
      customerLabel: s.customerLabel,
      customerPlaceholder: s.customerPlaceholder,
      variableAmount: s.variableAmount,
      requiresValidation: s.requiresValidation,
      billers: s.billers.map((b) => ({
        id: b.id,
        name: b.name,
        short: b.short,
        color: b.color,
        logo: logoById.get(b.id) ?? b.logo ?? null,
        // No provider biller code -> shown as "Coming soon" in the apps.
        comingSoon: !b.mapleradId,
      })),
      plans: s.plans.map((p) => ({
        id: p.id,
        billerId: p.billerId,
        name: p.name,
        amount: p.amount,
      })),
    }));
    return jsonOk({ services });
  } catch (err) {
    return toErrorResponse(err);
  }
}
