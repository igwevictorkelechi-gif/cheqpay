import { prisma, UserStatus } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse, ApiError } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin: single-user detail — profile, balances, recent KYC records and the
 * user's 10 most recent transactions.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        balances: { orderBy: { asset: "asc" } },
        kycRecords: { orderBy: { createdAt: "desc" }, take: 5 },
        transactions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    if (!user) throw new ApiError(404, "User not found", "not_found");

    const latestKyc = user.kycRecords[0];

    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone ?? "—",
        status: user.status,
        kycTier: user.kycTier,
        kycStatus:
          latestKyc?.status ?? (user.kycTier > 0 ? "APPROVED" : "PENDING"),
        createdAt: user.createdAt.toISOString(),
      },
      balances: user.balances.map((b) => ({
        asset: b.asset,
        available: fromMinorUnits(b.available, b.asset),
        locked: fromMinorUnits(b.locked, b.asset),
      })),
      kycRecords: user.kycRecords.map((k) => ({
        id: k.id,
        tier: k.tier,
        status: k.status,
        createdAt: k.createdAt.toISOString(),
      })),
      transactions: user.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        asset: t.asset,
        amount: fromMinorUnits(t.amount, t.asset),
        status: t.status,
        reference: t.externalRef ?? t.txHash ?? "—",
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: update a user's account status (ACTIVE/SUSPENDED/BLOCKED) and/or
 * KYC tier. Writes an audit-log entry for the change (best effort).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const body = (await req.json()) as { status?: unknown; kycTier?: unknown };

    const data: { status?: UserStatus; kycTier?: number } = {};

    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      const allowed = Object.values(UserStatus) as string[];
      if (!allowed.includes(s)) {
        throw new ApiError(422, `Invalid status: ${s}`, "validation_error");
      }
      data.status = s as UserStatus;
    }

    if (body.kycTier !== undefined) {
      const tier = Number(body.kycTier);
      if (!Number.isInteger(tier) || tier < 0 || tier > 3) {
        throw new ApiError(
          422,
          "kycTier must be an integer between 0 and 3",
          "validation_error",
        );
      }
      data.kycTier = tier;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(422, "No valid fields to update", "validation_error");
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "User not found", "not_found");

    const user = await prisma.user.update({ where: { id }, data });

    // Best-effort audit trail; never fail the request on logging errors.
    try {
      await prisma.auditLog.create({
        data: {
          userId: id,
          action: "admin.user.update",
          resourceType: "user",
          resourceId: id,
          details: {
            actor,
            status: data.status ?? null,
            kycTier: data.kycTier ?? null,
          },
        },
      });
    } catch (logErr) {
      console.error("audit log failed:", logErr);
    }

    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        kycTier: user.kycTier,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
