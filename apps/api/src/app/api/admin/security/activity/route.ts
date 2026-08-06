import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { ensureActivitySchema } from "@/lib/activity";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Login and device activity across all accounts — the Security section's data.
 *
 * Answers the questions asked when an account is suspected of being
 * compromised: where was it last used from, on what, when, what did it do last,
 * and which devices has it ever been seen on.
 *
 * `?userId=` narrows to one account and returns its full device list and recent
 * transactions. Without it, returns the most recently active accounts.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    await ensureActivitySchema();

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");

    if (userId) return jsonOk(await detail(userId));

    // Most recently active first: an investigation almost always starts from
    // "what has been happening lately".
    const users = await prisma.user.findMany({
      where: { lastSeenAt: { not: null } },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        username: true,
        legalName: true,
        status: true,
        lastSeenAt: true,
        lastIp: true,
        lastDevice: true,
        lastAction: true,
      },
    });

    // One query for all device counts rather than one per user.
    const counts = await prisma.userSession.groupBy({
      by: ["userId"],
      _count: { _all: true },
      where: { userId: { in: users.map((u) => u.id) } },
    });
    const byUser = new Map(counts.map((c) => [c.userId, c._count._all]));

    return jsonOk({
      users: users.map((u) => ({
        ...u,
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        deviceCount: byUser.get(u.id) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Everything security-relevant about one account. */
async function detail(userId: string) {
  const [user, sessions, transactions, audits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, username: true, legalName: true, status: true,
        lastSeenAt: true, lastIp: true, lastDevice: true, lastAction: true,
        createdAt: true,
      },
    }),
    prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    user: user && {
      ...user,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    devices: sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress || null,
      device: s.device,
      platform: s.platform,
      userAgent: s.userAgent || null,
      hitCount: s.hitCount,
      firstSeenAt: s.firstSeenAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
    lastTransactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      asset: t.asset,
      amount: fromMinorUnits(t.amount, t.asset),
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
    recentActions: audits.map((a) => ({
      action: a.action,
      resourceType: a.resourceType,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
