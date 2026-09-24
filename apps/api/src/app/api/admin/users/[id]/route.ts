import { Asset, Network, prisma, UserStatus } from "@cheqpay/db";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import {
  blockIps,
  ensureBlockedIpsSchema,
  invalidateAccessCache,
  knownIpsForUser,
  liftAuthBan,
  revokeAuthSessions,
} from "@/lib/accessControl";
import { jsonOk, toErrorResponse, ApiError } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { requestContext } from "@/lib/requestContext";
import { ensureActivitySchema } from "@/lib/activity";
import { ensureKycDocSchema, ensureMapleradSchema } from "@/lib/mapleradCustomer";
import { resolveApiOrigin, signKycDocumentUrl } from "@/lib/kycDocuments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** How long an admin's view of an ID document stays fetchable. */
const DOCUMENT_URL_TTL_SECONDS = 600;

/** Pull the recorded initiating IP out of a transaction's metadata, if any. */
function metadataIp(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const ip = (metadata as Record<string, unknown>).ip;
  return typeof ip === "string" && ip.trim() ? ip : null;
}

/**
 * Admin: everything about one account, in one request.
 *
 * Four things the list cannot show, and which an operator investigating an
 * account always ends up wanting at once:
 *
 *   what they submitted   the KYC identity — name, date of birth, address, ID
 *                         type and the document images.
 *   where they connect    every device/IP pair ever seen, plus the last one.
 *   where the money moved the IP that initiated the most recent transaction.
 *   what they have done   lifetime totals, lifecycle dates and risk signals.
 *
 * PII: the BVN and the ID number are shown as LAST FOUR only. Producing a whole
 * number is a weightier act with its own audit action, and it lives on the
 * compliance lookup (/api/admin/subjects/lookup?reveal=true). This page must not
 * widen where a full BVN can appear.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    // Named, even for a read: who looked at a customer's record is a question an
    // auditor asks, and "admin" is not an answer.
    const actor = (await requireAdminActor(req)).email;
    const { id } = await params;
    const { ip: adminIp } = requestContext(req);

    // Columns these reads touch are created lazily (migrations are not applied
    // on deploy), so make sure they exist before selecting them.
    await Promise.all([
      ensureActivitySchema(),
      ensureMapleradSchema(),
      ensureKycDocSchema(),
    ]);

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

    const [
      devices,
      byType,
      firstTx,
      totalTx,
      completedTx,
      failedTx,
      ipTx,
      ngnAccount,
    ] = await Promise.all([
      prisma.userSession.findMany({
        where: { userId: id },
        orderBy: { lastSeenAt: "desc" },
        take: 100,
      }),
      prisma.transaction.groupBy({
        by: ["type", "asset"],
        where: { userId: id },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.transaction.findFirst({
        where: { userId: id },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.transaction.count({ where: { userId: id } }),
      prisma.transaction.count({ where: { userId: id, status: "COMPLETED" } }),
      prisma.transaction.count({ where: { userId: id, status: "FAILED" } }),
      // The most recent transaction that actually carries an IP. Scanned rather
      // than taking transactions[0] because rows written before IPs were
      // recorded have none, and the newest such row is still the best answer.
      prisma.transaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, createdAt: true, metadata: true },
      }),
      prisma.wallet.findUnique({
        where: {
          userId_asset_network: { userId: id, asset: Asset.NGN, network: Network.FIAT },
        },
        select: { address: true },
      }),
    ]);

    const lastIpTx = ipTx.find((t) => metadataIp(t.metadata) !== null);

    // Document images. Signed per-document and best-effort: a storage problem
    // costs that thumbnail, never the whole page.
    const refs = latestKyc?.documentRefs ?? [];
    const origin = resolveApiOrigin(req);
    const [front, back] = await Promise.all(
      [refs[0], refs[1]].map(async (ref) => {
        if (!ref) return null;
        try {
          return signKycDocumentUrl(ref, DOCUMENT_URL_TTL_SECONDS, origin);
        } catch (err) {
          console.error("[admin] could not sign a KYC document", { userId: id, ref, err });
          return null;
        }
      })
    );

    const now = Date.now();
    const lastActivity = user.lastSeenAt ?? null;

    // Who looked at whose record is itself a thing auditors ask about — the
    // compliance lookup already logs it, and this page shows the same identity.
    // Best-effort: never fail the read because the log write failed.
    try {
      await prisma.auditLog.create({
        data: {
          userId: id,
          ipAddress: adminIp,
          action: "admin.user.viewed",
          resourceType: "user",
          resourceId: id,
          details: { actor },
        },
      });
    } catch (logErr) {
      console.error("audit log failed:", logErr);
    }

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

      // What the user actually filled in at KYC. Last-4s only for the numbers.
      kyc: {
        legalName: user.legalName,
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
        email: user.email,
        phone: user.phone,
        address: {
          street: user.addressStreet,
          city: user.addressCity,
          state: user.addressState,
          postalCode: user.addressPostalCode,
        },
        bvnLast4: user.bvnLast4,
        idDocType: user.idDocType,
        idDocNumberLast4: user.idDocNumberLast4,
        mapleradCustomerId: user.mapleradCustomerId,
        mapleradTier: user.mapleradTier,
        submittedAt: latestKyc?.createdAt.toISOString() ?? null,
        documents: { front, back },
      },

      // Where this account connects from.
      activity: {
        lastSeenAt: lastActivity?.toISOString() ?? null,
        lastIp: user.lastIp,
        lastDevice: user.lastDevice,
        lastAction: user.lastAction,
        lastTransactionIp: lastIpTx ? metadataIp(lastIpTx.metadata) : null,
        lastTransactionAt: lastIpTx?.createdAt.toISOString() ?? null,
        devices: devices.map((s) => ({
          id: s.id,
          ipAddress: s.ipAddress || null,
          device: s.device,
          platform: s.platform,
          userAgent: s.userAgent || null,
          hitCount: s.hitCount,
          firstSeenAt: s.firstSeenAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
        })),
      },

      stats: {
        // Lifetime money movement, per type. Amounts are summed per asset
        // because adding kobo to satoshis would be meaningless.
        byType: byType.map((g) => ({
          type: g.type,
          asset: g.asset,
          count: g._count._all,
          total: fromMinorUnits(g._sum.amount ?? 0n, g.asset),
        })),
        lifecycle: {
          accountAgeDays: Math.floor((now - user.createdAt.getTime()) / 86_400_000),
          firstTransactionAt: firstTx?.createdAt.toISOString() ?? null,
          lastTransactionAt: user.transactions[0]?.createdAt.toISOString() ?? null,
          daysSinceLastActivity: lastActivity
            ? Math.floor((now - lastActivity.getTime()) / 86_400_000)
            : null,
          totalTransactions: totalTx,
          completedTransactions: completedTx,
          failedTransactions: failedTx,
        },
        risk: {
          deviceCount: devices.length,
          distinctIpCount: new Set(devices.map((d) => d.ipAddress).filter(Boolean)).size,
          // Share of attempts that failed — a cheap signal that something is
          // wrong with an account (or with how it is being used).
          failedRate: totalTx > 0 ? Math.round((failedTx / totalTx) * 100) : 0,
          kycSubmissionCount: user.kycRecords.length,
          kycTier: user.kycTier,
          providerEnrolled: Boolean(user.mapleradCustomerId),
          depositAccountNumber: ngnAccount?.address ?? null,
        },
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
        // Blank for anything predating IP recording; the page shows "—".
        ip: metadataIp(t.metadata),
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: update a user's account status and/or KYC tier.
 *
 * Asymmetric on purpose. Taking trust AWAY is one click for any admin: blocking
 * or suspending an account, or lowering its tier, needs no second factor,
 * because the cost of a slow block is money leaving. GIVING trust is guarded,
 * because that is the direction the 22 Sep incident ran in:
 *
 *  - Blocking also ends the user's sessions, bans them at the login layer and,
 *    for BLOCKED, blocklists every address they have used. A block now actually
 *    stops the account — it did not before.
 *  - Unblocking needs a Super Admin, a fresh authenticator code and a reason.
 *  - Raising a tier needs a fresh authenticator code and the identity on file
 *    to back it: a name plus BVN or ID for tier 1, a government ID for tier 2.
 *    Tier 3 additionally needs a Super Admin and a reason. The account raised
 *    to tier 3 in the incident had no name, no BVN and no ID on file at all.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const actor = await requireAdminActor(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      status?: unknown;
      kycTier?: unknown;
      reason?: unknown;
      otp?: unknown;
      blockIps?: unknown;
    };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    const existing = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        status: true,
        kycTier: true,
        legalName: true,
        bvnFingerprint: true,
        idDocType: true,
        idDocNumberLast4: true,
      },
    });
    if (!existing) throw new ApiError(404, "User not found", "not_found");

    const data: { status?: UserStatus; kycTier?: number; instantWithdrawal?: boolean } = {};

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
        throw new ApiError(422, "kycTier must be an integer between 0 and 3", "validation_error");
      }
      data.kycTier = tier;
    }

    if (data.status === undefined && data.kycTier === undefined) {
      throw new ApiError(422, "No valid fields to update", "validation_error");
    }

    const restoring =
      data.status === UserStatus.ACTIVE && existing.status !== UserStatus.ACTIVE;
    const denying =
      data.status !== undefined &&
      data.status !== UserStatus.ACTIVE &&
      data.status !== existing.status;
    const raisingTier = data.kycTier !== undefined && data.kycTier > existing.kycTier;

    // --- Guards on granting trust -------------------------------------------
    if (restoring || (raisingTier && data.kycTier === 3)) {
      if (actor.role !== "super") {
        throw new ApiError(403, "Only a Super Admin can do this.", "super_only");
      }
      if (reason.length < 10) {
        throw new ApiError(422, "Give a reason (at least 10 characters) — it goes on the audit record.", "reason_required");
      }
    }
    if (raisingTier) {
      const hasIdentity = !!existing.legalName && (!!existing.bvnFingerprint || !!existing.idDocNumberLast4);
      const hasGovId = !!existing.idDocType && !!existing.idDocNumberLast4;
      if (!hasIdentity) {
        throw new ApiError(
          422,
          "This account has no verified identity on file (legal name plus BVN or ID). A tier can't be raised until they complete KYC.",
          "no_identity_on_file",
        );
      }
      if (data.kycTier! >= 2 && !hasGovId) {
        throw new ApiError(
          422,
          "Tier 2 and above need a government ID on file. Ask the user to upload one in KYC first.",
          "no_government_id",
        );
      }
    }
    if (restoring || raisingTier) {
      await requireAdminOtp(req, body.otp);
    }

    // A blocked or suspended account keeps no instant-withdrawal privilege.
    if (denying) data.instantWithdrawal = false;

    const user = await prisma.user.update({ where: { id }, data });

    // --- Side effects that make a status change real ------------------------
    let ipsBlocked: string[] = [];
    let sessionsRevoked = false;
    if (denying) {
      sessionsRevoked = await revokeAuthSessions(id);
      if (data.status === UserStatus.BLOCKED && body.blockIps !== false) {
        ipsBlocked = await blockIps(await knownIpsForUser(id), {
          reason: reason || `Blocked with account ${existing.email}`,
          actor: actor.email,
          sourceUserId: id,
        }).catch((err) => {
          console.error("[admin] could not blocklist IPs", err);
          return [] as string[];
        });
      }
    }
    if (restoring) {
      await liftAuthBan(id);
      // Addresses blocked BECAUSE of this account go with it; addresses blocked
      // for other reasons stay.
      await ensureBlockedIpsSchema();
      await prisma.$executeRawUnsafe(`DELETE FROM blocked_ips WHERE source_user_id = $1::uuid`, id);
    }
    invalidateAccessCache(id);

    const parts: string[] = [];
    if (data.status !== undefined) parts.push(`status ${existing.status} → ${data.status}`);
    if (data.kycTier !== undefined) parts.push(`KYC tier ${existing.kycTier} → ${data.kycTier}`);
    await recordAdminAction(req, actor, {
      action: "admin.user.update",
      summary: `${existing.email}: ${parts.join(", ")}`,
      userId: id,
      resourceType: "user",
      details: {
        status: data.status ?? null,
        previousStatus: existing.status,
        kycTier: data.kycTier ?? null,
        previousKycTier: existing.kycTier,
        reason: reason || null,
        sessionsRevoked,
        ipsBlocked,
      },
    });

    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        kycTier: user.kycTier,
      },
      ipsBlocked,
      sessionsRevoked,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
