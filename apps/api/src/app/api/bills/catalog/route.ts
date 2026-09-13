import { prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getBillCatalog } from "@/lib/billCatalog";
import { getCashbackConfig } from "@/lib/settings";
import { valueDataPlans, type ValuedPlan } from "@/lib/dataPlanValue";
import type { BillPlan } from "@/lib/bills";

export const dynamic = "force-dynamic";

/**
 * Public catalog of bill services, billers and plans the app offers. Data and
 * cable plans are the provider's live lists, so every price shown here is one
 * the provider will actually honour.
 */
export async function GET() {
  try {
    // Admin-uploaded logos override the default wordmark tiles.
    const assets = await prisma.billerAsset.findMany();
    const logoById = new Map(assets.map((a) => [a.billerId, a.logo]));

    const catalog = await getBillCatalog();

    // Strip provider-internal biller/plan codes from the public payload.
    const services = catalog.map((s) => ({
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
      plans: (s.service === "data" ? rankPerBiller(s.plans) : s.plans).map((p) => {
        const v = p as Partial<ValuedPlan>;
        return {
          id: p.id,
          billerId: p.billerId,
          name: p.name,
          amount: p.amount,
          // Ranked server-side so web and mobile show the same order and
          // neither has to re-derive value from a display string.
          sizeLabel: v.sizeLabel ?? null,
          validityLabel: v.validityLabel ?? null,
          nairaPerGb: v.nairaPerGb ?? null,
          bucket: v.bucket ?? null,
          night: v.night ?? false,
          bonusLabel: v.bonusLabel ?? null,
          hot: v.hot ?? false,
          bestValue: v.bestValue ?? false,
        };
      }),
    }));

    // The live cashback rate, so a plan tile can show what it actually earns
    // instead of a number the apps invent. Same config the award path uses, so
    // the figure shown is the figure paid.
    const cb = await getCashbackConfig();
    const cashback = {
      enabled: cb.enabled,
      billBps: cb.billBps,
      maxNgn: cb.maxNgn,
    };

    return jsonOk({ services, cashback });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Rank each biller's data bundles against its OWN list.
 *
 * Ranking across billers would let a cheap MTN bundle mark an Airtel plan as
 * poor value, when the customer has already chosen their network and can only
 * buy from that one. The comparison that helps them is within the biller.
 */
function rankPerBiller(plans: BillPlan[]): BillPlan[] {
  const byBiller = new Map<string, BillPlan[]>();
  for (const p of plans) {
    const list = byBiller.get(p.billerId);
    if (list) list.push(p);
    else byBiller.set(p.billerId, [p]);
  }
  return [...byBiller.values()].flatMap((group) => valueDataPlans(group));
}
