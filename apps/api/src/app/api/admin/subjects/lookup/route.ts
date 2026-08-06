import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { decryptPii, fingerprintPii, isPiiEncryptionConfigured } from "@/lib/pii";
import { ensureRetentionSchema } from "@/lib/retention";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Compliance subject lookup — the endpoint an investigation actually needs.
 *
 * Given whatever identifier the authorities arrive with (a BVN, a phone number,
 * a name, an account email, a username, or a single transaction reference),
 * find the account and return its identity and full history.
 *
 * Searches CLOSED accounts as well as open ones. A subject who deleted their
 * account is exactly the subject an investigator is most likely to be asking
 * about, and their identity is retained in `retained_subjects` for five years
 * (see lib/retention.ts).
 *
 * Every lookup is written to the audit log with the admin's identity and the
 * search term. Access to customer records is itself a thing auditors examine:
 * "who looked up whom, and when" must be answerable.
 *
 * The full BVN is returned ONLY when `reveal=true` is passed, and that is
 * recorded as a distinct audit action. Staff confirming a match need the last
 * four; producing the whole number to a regulator is a rarer, weightier act and
 * the log should be able to tell the two apart.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    // requireAdmin returns void; the dashboard identifies the operator with
    // this header, the same convention the other admin routes use.
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    await ensureRetentionSchema();

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const reveal = url.searchParams.get("reveal") === "true";
    if (q.length < 3) {
      throw new ApiError(422, "Enter at least 3 characters to search", "query_too_short");
    }

    const digits = q.replace(/\D/g, "");
    const isBvn = /^\d{11}$/.test(digits);

    // A BVN is matched by its keyed fingerprint, never by scanning ciphertext:
    // encryption uses a fresh IV per row, so equal BVNs do not produce equal
    // ciphertexts and a LIKE would find nothing.
    const bvnFingerprint =
      isBvn && isPiiEncryptionConfigured() ? fingerprintPii(digits) : undefined;

    const contains = { contains: q, mode: "insensitive" as const };

    const users = await prisma.user.findMany({
      where: {
        OR: [
          ...(bvnFingerprint ? [{ bvnFingerprint }] : []),
          { email: contains },
          { username: contains },
          { legalName: contains },
          ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      take: 25,
    });

    // Closed accounts: the live row has been scrubbed, so the identity only
    // exists in the retained snapshot.
    const retained = await prisma.retainedSubject.findMany({
      where: {
        OR: [
          ...(bvnFingerprint ? [{ bvnFingerprint }] : []),
          { email: contains },
          { username: contains },
          { legalName: contains },
          ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      take: 25,
    });

    // A transaction reference is the other thing an investigator arrives with.
    const byRef = await prisma.transaction.findMany({
      where: { OR: [{ id: isUuid(q) ? q : undefined }, { externalRef: q }, { txHash: q }] },
      select: { userId: true },
      take: 25,
    });

    const ids = new Set<string>([
      ...users.map((u) => u.id),
      ...retained.map((r) => r.userId),
      ...byRef.map((t) => t.userId),
    ]);

    await prisma.auditLog.create({
      data: {
        action: reveal ? "compliance.subject.reveal" : "compliance.subject.lookup",
        resourceType: "ComplianceLookup",
        details: {
          admin: actor,
          query: isBvn ? `BVN ending ${digits.slice(-4)}` : q,
          matches: ids.size,
        },
      },
    });

    const subjects = await Promise.all([...ids].map((id) => buildSubject(id, reveal)));
    return jsonOk({ query: q, count: subjects.length, subjects: subjects.filter(Boolean) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Full dossier for one subject: who they are, and everything they did. */
async function buildSubject(userId: string, reveal: boolean) {
  const [user, snapshot, transactions, kyc, audits] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.retainedSubject.findUnique({ where: { userId } }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.kycRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  if (!user && !snapshot) return null;

  const closed = !!snapshot;
  // For a closed account the live row is scrubbed, so identity comes from the
  // retained snapshot; for an open one it comes from the profile.
  const src = snapshot ?? user!;

  let bvn: string | null = null;
  if (reveal && src.bvnCiphertext && isPiiEncryptionConfigured()) {
    try {
      bvn = decryptPii(src.bvnCiphertext);
    } catch (err) {
      console.error("[compliance] BVN decryption failed", err);
      bvn = null;
    }
  }

  return {
    userId,
    status: closed ? "CLOSED" : user!.status,
    identity: {
      legalName: src.legalName,
      email: src.email,
      phone: src.phone,
      username: src.username,
      dateOfBirth: src.dateOfBirth ? src.dateOfBirth.toISOString().slice(0, 10) : null,
      bvnLast4: src.bvnLast4,
      // Only present when explicitly revealed, and that call is audited.
      bvn,
      kycTier: src.kycTier,
    },
    retention: snapshot
      ? {
          closedAt: snapshot.closedAt.toISOString(),
          retainUntil: snapshot.retainUntil.toISOString(),
          reason: snapshot.reason,
        }
      : null,
    kycRecords: kyc.map((k) => ({
      id: k.id,
      tier: k.tier,
      status: k.status,
      documentRefs: k.documentRefs,
      reviewedAt: k.reviewedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
    transactionCount: transactions.length,
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      asset: t.asset,
      // Serialized in major units: a report read by a human, not a machine.
      amount: fromMinorUnits(t.amount, t.asset),
      fee: fromMinorUnits(t.fee, t.asset),
      status: t.status,
      externalRef: t.externalRef,
      txHash: t.txHash,
      metadata: t.metadata,
      createdAt: t.createdAt.toISOString(),
    })),
    auditTrail: audits.map((a) => ({
      action: a.action,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      details: a.details,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
