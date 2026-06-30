import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getAllBillers } from "@/lib/bills";

export const dynamic = "force-dynamic";

/** Admin: list every biller with its current (uploaded or default) logo. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const assets = await prisma.billerAsset.findMany();
    const logoById = new Map(assets.map((a) => [a.billerId, a.logo]));

    const billers = getAllBillers().map((b) => ({
      id: b.id,
      name: b.name,
      short: b.short,
      color: b.color,
      service: b.service,
      serviceLabel: b.serviceLabel,
      logo: logoById.get(b.id) ?? b.logo ?? null,
      hasUpload: logoById.has(b.id),
    }));
    return jsonOk({ billers });
  } catch (err) {
    return toErrorResponse(err);
  }
}
