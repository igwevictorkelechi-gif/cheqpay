import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { describeProviderError } from "@/lib/mapleradCustomer";
import { previewStuckBills, settleStuckBills } from "@/lib/billReconcile";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function requireUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new ApiError(404, "No such user", "user_not_found");
}

/**
 * Admin-only: this user's bills that never settled, and which the provider
 * confirms actually went through.
 *
 * Bills settle on a bill.* webhook; one that never arrives leaves the purchase
 * PROCESSING with the customer debited and nobody able to say whether the
 * airtime landed. Read-only — POST does the settling.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    await requireUser(id);

    try {
      return jsonOk(await previewStuckBills(id));
    } catch (err) {
      return jsonOk({ ok: false, error: describeProviderError(err) });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin-only: settle the stuck bills the provider confirms.
 *
 * Body `{ ids: string[] }` settles exactly those; omit it to settle every
 * confirmed one. Only ever settles as successful, and only where Maplerad's own
 * purchase history proves the bill went through — absence from that history is
 * never treated as failure, because refunding a bill the customer actually
 * received would give the money back twice.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    await requireUser(id);
    const actor = req.headers.get("x-admin-actor") ?? "admin";

    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : undefined;

    let result;
    try {
      result = await settleStuckBills(id, ids);
    } catch (err) {
      return jsonOk({ ok: false, error: describeProviderError(err) });
    }

    await prisma.auditLog.create({
      data: {
        userId: id,
        action: "admin.bills.reconciled",
        resourceType: "User",
        resourceId: id,
        details: { actor, requested: ids ?? "all_confirmed", settled: result.summary.settled ?? 0 },
      },
    });

    return jsonOk(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
