import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { describeProviderError } from "@/lib/mapleradCustomer";
import {
  previewReconciliation,
  commitReconciliation,
} from "@/lib/maplerad/reconcile";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Look a user's Maplerad customer id up, refusing clearly when there isn't one.
 *
 * No customer id means the account never enrolled with Maplerad, so there is
 * nothing to reconcile — a distinct, actionable state, not a server error.
 */
async function requireCustomerId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mapleradCustomerId: true },
  });
  if (!user) throw new ApiError(404, "No such user", "user_not_found");
  if (!user.mapleradCustomerId) {
    throw new ApiError(
      422,
      "This user is not enrolled with Maplerad, so there are no deposits to reconcile.",
      "no_customer",
    );
  }
  return user.mapleradCustomerId;
}

/**
 * Admin-only: list what Maplerad recorded for this user's account and show which
 * deposits reached their in-app balance and which did not.
 *
 * Read-only. This is the answer to "I deposited but it didn't show up": it reads
 * the customer's transaction history straight from Maplerad — the reliable
 * record, since the deposit webhook has been unreliable — and marks each row
 * already-credited, creditable-now, or why not. Credits nothing; POST does that.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const customerId = await requireCustomerId(id);

    let result;
    try {
      result = await previewReconciliation(customerId);
    } catch (err) {
      return jsonOk({ ok: false, error: describeProviderError(err) });
    }
    return jsonOk(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin-only: credit the selected missing deposits.
 *
 * Body `{ ids: string[] }` credits exactly those transactions (what the operator
 * ticked after reviewing the amounts); `{ all: true }` credits every
 * creditable-and-missing row. Crediting goes through the same idempotent path as
 * the webhook — shared `deposit:maplerad:${id}` key — so re-running it, or a
 * webhook arriving later, cannot double-credit. Each credit is audited.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const customerId = await requireCustomerId(id);
    const actor = req.headers.get("x-admin-actor") ?? "admin";

    const body = (await req.json().catch(() => ({}))) as {
      ids?: unknown;
      all?: unknown;
    };
    const all = body.all === true;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];

    if (!all && ids.length === 0) {
      throw new ApiError(
        422,
        "Select at least one deposit to credit, or pass all:true.",
        "nothing_selected",
      );
    }

    let result;
    try {
      result = await commitReconciliation(id, customerId, { ids, all });
    } catch (err) {
      return jsonOk({ ok: false, error: describeProviderError(err) });
    }

    await prisma.auditLog.create({
      data: {
        userId: id,
        action: "admin.deposits.reconciled",
        resourceType: "User",
        resourceId: id,
        details: {
          actor,
          requested: all ? "all" : ids,
          credited: result.summary.credited ?? 0,
        },
      },
    });

    return jsonOk(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
