import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { decryptPii, isPiiEncryptionConfigured } from "@/lib/pii";
import { lookupBvnIdentity } from "@/lib/maplerad/identity";
import { describeProviderError } from "@/lib/mapleradCustomer";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin-only: look this user's BVN up at NIBSS and show what it holds.
 *
 * "could not validate BVN" at enrolment means the BVN, name and date of birth
 * we send do not agree with NIBSS — most often a name entered surname-first. A
 * lookup returns the authoritative name and DOB, so an operator can see the
 * mismatch and correct our stored values to match rather than guessing.
 *
 * Pass `{ bvn }` to check a specific number (e.g. one the user just re-read from
 * *565*0#); omit it to check the BVN already on file. Read-only — it neither
 * enrols nor changes anything, but a lookup is a billed NIBSS query, so it runs
 * only on this explicit request and is written to the audit log.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const actor = req.headers.get("x-admin-actor") ?? "admin";

    const body = (await req.json().catch(() => ({}))) as { bvn?: unknown };
    let bvn = typeof body.bvn === "string" ? body.bvn.replace(/\D/g, "") : "";

    const user = await prisma.user.findUnique({
      where: { id },
      select: { legalName: true, dateOfBirth: true, bvnCiphertext: true, bvnLast4: true },
    });
    if (!user) throw new ApiError(404, "No such user", "user_not_found");

    // Fall back to the BVN on file when the operator did not type one.
    let source: "supplied" | "on file" = "supplied";
    if (!bvn) {
      if (!user.bvnCiphertext || !isPiiEncryptionConfigured()) {
        throw new ApiError(
          422,
          "No BVN on file to check — type one to verify it directly.",
          "no_bvn",
        );
      }
      try {
        bvn = decryptPii(user.bvnCiphertext);
      } catch {
        throw new ApiError(500, "The stored BVN could not be decrypted.", "bvn_decrypt_failed");
      }
      source = "on file";
    }

    if (!/^\d{11}$/.test(bvn)) {
      throw new ApiError(422, "A BVN is exactly 11 digits.", "bad_bvn");
    }

    let identity;
    try {
      identity = await lookupBvnIdentity(bvn);
    } catch (err) {
      // NIBSS/Maplerad's own words — "BVN not found", a rate limit, etc.
      return jsonOk({ ok: false, source, error: describeProviderError(err) });
    }

    // What we currently hold, so the operator sees the mismatch without cross-
    // referencing another panel. Only the last 4 of the BVN is ever echoed.
    const [ourFirst, ...ourRest] = (user.legalName ?? "").trim().split(/\s+/);
    const held = {
      firstName: ourFirst || null,
      lastName: ourRest.join(" ") || null,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
      bvnLast4: user.bvnLast4,
    };

    // Field-level agreement, case-insensitive on names. This is the answer to
    // "why did NIBSS reject it" at a glance.
    const eq = (a: string | null, b: string | null) =>
      !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    const matches = {
      firstName: eq(held.firstName, identity.firstName),
      lastName: eq(held.lastName, identity.lastName),
      dateOfBirth: eq(held.dateOfBirth, identity.dateOfBirth),
    };

    await prisma.auditLog.create({
      data: {
        userId: id,
        action: "admin.kyc.bvn_verified",
        resourceType: "User",
        resourceId: id,
        // The lookup happened and who ran it — never the returned identity.
        details: { source, bvnLast4: bvn.slice(-4), actor },
      },
    });

    return jsonOk({
      ok: true,
      source,
      // NIBSS's record.
      identity: {
        firstName: identity.firstName,
        lastName: identity.lastName,
        middleName: identity.middleName,
        dateOfBirth: identity.dateOfBirth,
        phone: identity.phone,
        gender: identity.gender,
      },
      held,
      matches,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
