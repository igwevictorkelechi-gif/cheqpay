// apps/api/src/lib/devapi/customers.ts
//
// A developer's customers (their own end users) and identity verification.
//
// "Verified" means, in live mode:
//   1. the person is enrolled with our banking partner with their BVN, name,
//      date of birth, phone and address — the partner refuses details that
//      don't belong to one person — which gives the tier collections need;
//   2. their government ID document was accepted (tier 2);
//   3. our own checks passed: 18 or over, a Nigerian mobile number, one
//      customer per BVN per developer, and not an identity CheqPay has blocked.
// Only then do the customer's NGN and USD wallets open, and only a verified
// customer can be given a virtual account or a card.
//
// Live verification runs after the response (the partner can take seconds);
// the developer hears the outcome as customer.verified / customer.rejected. A
// partner outage leaves the customer pending and is retried on a backoff.
// The sandbox never calls the partner: verification is decided by test values,
// so it can't be used to look up real people.
//
// Nothing identifying is returned or logged: BVN, ID number, date of birth and
// address are encrypted at rest and write-only through the API (bvn_last4 is
// all that comes back). Rejection reasons are ours and generic — never the
// partner's text — so the API can't be used to learn anything about a BVN.

import { randomUUID } from "node:crypto";
import { UserStatus, prisma } from "@cheqpay/db";
import { z } from "zod";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { decryptPii, encryptPii, fingerprintPii } from "../pii";
import { normaliseNgnPhone } from "../ngnPhone";
import { enrollCustomer, upgradeCustomerTier2 } from "../maplerad/customers";
import { isDefiniteRejection } from "../providerErrors";
import { checkRateLimit } from "../ratelimit";
import { alertOpsOnce } from "../opsAlert";
import { describeProviderError } from "../mapleradCustomer";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { ensureDevApiSchema } from "./ensureDevApi";
import { assertPiiReady, publicApiOrigin, signDevFileUrl } from "./files";
import { ensureCustomerWallets } from "./ledger";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { metadataSchema, referenceSchema, uniqueViolation } from "./inputs";
import { listParams, type Page, type Scope } from "./lists";
import { runIdempotent } from "./idempotency";
import { later } from "./audit";
import { scrubSensitive } from "./redact";
import type { DevPlan } from "./plans";
import type { CustomerRow, IdentityType, Mode } from "./types";

/** Sandbox test values. Any other valid BVN verifies. */
export const SANDBOX_BVN = { rejected: "22222222222", pending: "33333333333" } as const;
/** How long the sandbox's "pending" BVN stays pending. */
export const SANDBOX_PENDING_MS = 60_000;

/** Public rejection reasons. Never the partner's own words. */
export const KYC_REASONS: Record<string, string> = {
  identity_mismatch: "The BVN, name and date of birth don't match one person. Check them and update the customer.",
  id_document_rejected: "The identity document wasn't accepted. Upload a clear photo of a valid, unexpired ID and update the customer.",
  verification_declined: "This person can't be verified for CheqPay services.",
  verification_unavailable: "Verification couldn't be completed. Update the customer to try again, or contact dev@mycheqpay.com.",
};

/** Minutes between live verification retries after a partner outage. */
const RETRY_MINUTES = [5, 30, 120, 360, 1_440];
/** How long one verification attempt holds its claim on a customer. */
const ATTEMPT_LEASE = "10 minutes";

// ---- Input ------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^\p{L}[\p{L}\p{M} .'’-]*$/u, "Use letters, spaces, hyphens and apostrophes only");

const addressSchema = z
  .object({
    street: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().min(2).max(60),
    postal_code: z.string().trim().min(3).max(12).regex(/^[A-Za-z0-9 -]+$/, "Letters, digits, spaces and hyphens only"),
  })
  .strict();

const identitySchema = z
  .object({
    type: z.enum(["NIN", "PASSPORT", "VOTERS_CARD", "DRIVERS_LICENSE"]),
    number: z.string().trim().min(4).max(30).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and hyphens only"),
    document_front: z.string().max(80),
    document_back: z.string().max(80).optional(),
  })
  .strict();

const consent = z.literal(true, {
  errorMap: () => ({ message: "Set kyc_consent to true to confirm the customer agreed to identity checks" }),
});

export const customerCreateSchema = z
  .object({
    first_name: nameSchema,
    middle_name: nameSchema.optional(),
    last_name: nameSchema,
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().min(7).max(20),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    bvn: z.string().regex(/^\d{11}$/, "A BVN is exactly 11 digits"),
    address: addressSchema,
    identity: identitySchema,
    kyc_consent: consent,
    reference: referenceSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const customerUpdateSchema = z
  .object({
    first_name: nameSchema.optional(),
    middle_name: nameSchema.nullable().optional(),
    last_name: nameSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
    bvn: z.string().regex(/^\d{11}$/, "A BVN is exactly 11 digits").optional(),
    address: addressSchema.optional(),
    identity: identitySchema.optional(),
    kyc_consent: consent.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

type CreateBody = z.infer<typeof customerCreateSchema>;
type UpdateBody = z.infer<typeof customerUpdateSchema>;
type Address = z.infer<typeof addressSchema>;

function checkPhone(raw: string): string {
  const phone = normaliseNgnPhone(raw);
  if (!phone) throw new V1Error(400, "phone must be a Nigerian mobile number, e.g. 08031234567.", "validation_error", "phone");
  return phone;
}

/** The date, if real, for someone aged 18 to 120 today. */
function checkDob(iso: string, now: Date = new Date()): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new V1Error(400, "date_of_birth isn't a real date.", "validation_error", "date_of_birth");
  }
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  if (age < 18) throw new V1Error(400, "Customers must be at least 18 years old.", "validation_error", "date_of_birth");
  if (age > 120) throw new V1Error(400, "date_of_birth isn't plausible.", "validation_error", "date_of_birth");
  return iso;
}

function fileParam(value: string | undefined, param: string): string | null {
  if (value === undefined) return null;
  const id = fromPublicId("file", value);
  if (!id) throw new V1Error(400, "That isn't a file id from POST /v1/files.", "invalid_file", param);
  return id;
}

/** The file must be an identity document of this account and mode, not used by another customer. */
async function assertIdentityFile(scope: Scope, fileId: string, param: string, customerId: string | null): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ purpose: string; used: boolean }[]>(
    `SELECT f.purpose,
            EXISTS (SELECT 1 FROM dev_customers c
                     WHERE (c.id_front_file_id = f.id OR c.id_back_file_id = f.id)
                       AND ($4::uuid IS NULL OR c.id <> $4::uuid)) AS used
       FROM dev_files f WHERE f.id = $1::uuid AND f.account_id = $2::uuid AND f.mode = $3`,
    fileId,
    scope.accountId,
    scope.mode,
    customerId,
  );
  const f = rows[0];
  if (!f || f.purpose !== "identity_document" || f.used) {
    throw new V1Error(400, "Upload the document with POST /v1/files (purpose identity_document) and use its id, once per customer.", "invalid_file", param);
  }
}

/** Identity checks cost money in live mode; they get their own, tighter limits. */
async function assertKycRate(scope: Scope): Promise<void> {
  const perMinute = await checkRateLimit(`devapi:kyc:${scope.accountId}:${scope.mode}`, scope.mode === "live" ? 20 : 60, 60_000);
  if (!perMinute.allowed) {
    throw new V1Error(429, "Too many identity checks in a minute. Slow down and retry.", "rate_limited", null, Math.max(1, Math.ceil((perMinute.resetAt - Date.now()) / 1000)));
  }
  if (scope.mode === "live") {
    const perDay = await checkRateLimit(`devapi:kycday:${scope.accountId}`, 500, 86_400_000);
    if (!perDay.allowed) {
      throw new V1Error(429, "Your account has reached today's limit of identity checks. Contact dev@mycheqpay.com to raise it.", "rate_limited", null, Math.max(1, Math.ceil((perDay.resetAt - Date.now()) / 1000)));
    }
  }
}

async function assertCustomerCap(scope: Scope, plan: DevPlan): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM dev_customers WHERE account_id = $1::uuid AND mode = $2`,
    scope.accountId,
    scope.mode,
  );
  if (Number(rows[0]?.n ?? 0) >= plan.maxCustomers) {
    throw new V1Error(403, `Your plan allows ${plan.maxCustomers.toLocaleString("en-US")} customers in ${scope.mode} mode.`, "plan_limit_reached");
  }
}

// ---- Reads ------------------------------------------------------------------

export async function getCustomer(scope: Scope, id: string): Promise<CustomerRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(
    `SELECT * FROM dev_customers WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

async function loadCustomer(id: string): Promise<CustomerRow | null> {
  const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(`SELECT * FROM dev_customers WHERE id = $1::uuid`, id);
  return rows[0] ?? null;
}

export async function listCustomers(scope: Scope, q: URLSearchParams): Promise<Page<CustomerRow>> {
  await ensureDevApiSchema();
  const { limit, startingAfter } = listParams(q);
  const status = q.get("kyc_status");
  if (status !== null && !["pending", "verified", "rejected"].includes(status)) {
    throw new V1Error(400, "kyc_status must be pending, verified or rejected.", "validation_error", "kyc_status");
  }
  const email = q.get("email")?.trim().toLowerCase() ?? null;
  if (email !== null && (email.length < 3 || email.length > 254)) throw new V1Error(400, "email is not valid.", "validation_error", "email");
  const reference = q.get("reference");
  if (reference !== null && (reference.length < 1 || reference.length > 100)) {
    throw new V1Error(400, "reference must be 1 to 100 characters.", "validation_error", "reference");
  }
  const after = startingAfter ? fromPublicId("customer", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be a customer id.", "validation_error", "starting_after");
  const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(
    `SELECT * FROM dev_customers c
      WHERE c.account_id = $1::uuid AND c.mode = $2
        AND ($3::text IS NULL OR c.kyc_status = $3)
        AND ($4::text IS NULL OR c.email = $4)
        AND ($5::text IS NULL OR c.reference = $5)
        AND ($6::uuid IS NULL OR (c.created_at, c.id) < (SELECT x.created_at, x.id FROM dev_customers x
              WHERE x.id = $6::uuid AND x.account_id = $1::uuid AND x.mode = $2))
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $7`,
    scope.accountId,
    scope.mode,
    status,
    email,
    reference,
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}

export function customerObject(c: CustomerRow) {
  return {
    object: "customer",
    id: toPublicId("customer", c.id),
    first_name: c.first_name,
    middle_name: c.middle_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    bvn_last4: c.bvn_last4,
    identity: { type: c.id_type },
    kyc: {
      status: c.kyc_status,
      reason:
        c.kyc_status === "rejected" && c.kyc_reason
          ? { code: c.kyc_reason, message: KYC_REASONS[c.kyc_reason] ?? KYC_REASONS.verification_unavailable }
          : null,
      verified_at: c.verified_at?.toISOString() ?? null,
    },
    reference: c.reference,
    metadata: c.metadata ?? {},
    livemode: c.mode === "live",
    created_at: c.created_at.toISOString(),
  };
}

/** A sandbox customer left "pending" by the test BVN settles once its minute is up, whenever it is next read. */
export async function refreshSandboxPending(c: CustomerRow): Promise<CustomerRow> {
  if (c.mode !== "test" || c.kyc_status !== "pending") return c;
  if (c.kyc_next_attempt_at && c.kyc_next_attempt_at > new Date()) return c;
  return runVerification(c.id);
}

// ---- Create -----------------------------------------------------------------

export async function createCustomer(ctx: ApiContext<CreateBody>): Promise<HandlerResult> {
  assertPiiReady();
  await ensureDevApiSchema();
  const b = ctx.body;
  const phone = checkPhone(b.phone);
  const dob = checkDob(b.date_of_birth);
  const frontId = fileParam(b.identity.document_front, "identity.document_front")!;
  const backId = fileParam(b.identity.document_back, "identity.document_back");
  if (backId && backId === frontId) {
    throw new V1Error(400, "Use different files for the front and back.", "invalid_file", "identity.document_back");
  }

  return runIdempotent(ctx, b, {
    replay: async (id) => ({ body: customerObject((await getCustomer(ctx.scope, id))!) }),
    work: async (complete) => {
      await assertIdentityFile(ctx.scope, frontId, "identity.document_front", null);
      if (backId) await assertIdentityFile(ctx.scope, backId, "identity.document_back", null);
      await assertCustomerCap(ctx.scope, ctx.plan);
      await assertKycRate(ctx.scope);

      const id = randomUUID();
      const fingerprint = fingerprintPii(b.bvn);
      try {
        await prisma.$transaction(async (db) => {
          await db.$executeRawUnsafe(
            `INSERT INTO dev_customers (id, account_id, mode, first_name, middle_name, last_name, email, phone,
               dob_enc, address_enc, bvn_enc, bvn_fingerprint, bvn_last4, id_type, id_number_enc,
               id_front_file_id, id_back_file_id, reference, metadata)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::uuid, $17::uuid, $18, $19::jsonb)`,
            id,
            ctx.scope.accountId,
            ctx.scope.mode,
            b.first_name,
            b.middle_name ?? null,
            b.last_name,
            b.email,
            phone,
            encryptPii(dob),
            encryptPii(JSON.stringify(b.address)),
            encryptPii(b.bvn),
            fingerprint,
            b.bvn.slice(-4),
            b.identity.type,
            encryptPii(b.identity.number),
            frontId,
            backId,
            b.reference ?? null,
            JSON.stringify(b.metadata ?? {}),
          );
          await complete(db, "customer", id, 201);
        });
      } catch (err) {
        await throwForUniqueViolation(err, ctx.scope, fingerprint);
        throw err;
      }
      if (ctx.mode === "live") void watchForAbuse(ctx.scope, fingerprint);

      return { status: 201, body: customerObject(await startVerification(id, ctx.mode)) };
    },
  });
}

async function throwForUniqueViolation(err: unknown, scope: Scope, fingerprint: string): Promise<void> {
  const cols = uniqueViolation(err);
  if (!cols) return;
  if (cols.includes("bvn_fingerprint")) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM dev_customers WHERE account_id = $1::uuid AND mode = $2 AND bvn_fingerprint = $3`,
      scope.accountId,
      scope.mode,
      fingerprint,
    );
    const existing = rows[0] ? ` (${toPublicId("customer", rows[0].id)})` : "";
    throw new V1Error(409, `A customer with this BVN already exists${existing}. Each person is one customer.`, "customer_exists", "bvn");
  }
  if (cols.includes("reference")) {
    throw new V1Error(409, "Another customer already uses this reference.", "duplicate_reference", "reference");
  }
  if (cols.includes("id_front_file_id")) {
    throw new V1Error(400, "That document is already attached to another customer.", "invalid_file", "identity.document_front");
  }
}

/** The same BVN at several developers, or a burst of rejections, is worth a human look. */
async function watchForAbuse(scope: Scope, fingerprint: string): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(DISTINCT account_id)::bigint AS n FROM dev_customers WHERE bvn_fingerprint = $1 AND mode = 'live'`,
      fingerprint,
    );
    if (Number(rows[0]?.n ?? 0) >= 3) {
      await alertOpsOnce(
        `devapi-bvn-spread:${fingerprint.slice(0, 16)}`,
        "⚠️ Developer API: one BVN is now a customer at 3 or more developer accounts. Review for identity misuse.",
        { latest_account: scope.accountId },
      );
    }
  } catch (err) {
    console.error("[devapi] abuse check failed", err);
  }
}

// ---- Update / resubmit ------------------------------------------------------

const KYC_FIELDS = ["first_name", "middle_name", "last_name", "email", "phone", "date_of_birth", "bvn", "address", "identity"] as const;

export async function updateCustomer(ctx: ApiContext<UpdateBody>, customerId: string): Promise<HandlerResult> {
  const b = ctx.body;
  const c = await getCustomer(ctx.scope, customerId);
  if (!c) throw new V1Error(404, "No such customer.", "not_found", "id");
  const touchesKyc = KYC_FIELDS.some((k) => b[k] !== undefined);

  if (!touchesKyc) {
    if (b.metadata !== undefined) {
      await prisma.$executeRawUnsafe(
        `UPDATE dev_customers SET metadata = $2::jsonb, updated_at = now() WHERE id = $1::uuid`,
        c.id,
        JSON.stringify(b.metadata),
      );
    }
    return { body: customerObject((await getCustomer(ctx.scope, c.id))!) };
  }

  if (c.kyc_status !== "rejected") {
    throw new V1Error(409, "This customer is verified or being verified, so their details can't change. Only metadata can be updated.", "customer_locked");
  }
  if (b.kyc_consent !== true) {
    throw new V1Error(400, "Set kyc_consent to true to confirm the customer agreed to identity checks.", "validation_error", "kyc_consent");
  }
  assertPiiReady();
  if (!c.bvn_enc || !c.dob_enc || !c.address_enc || !c.id_number_enc) {
    throw new V1Error(409, "This sandbox customer's details were deleted after 90 days. Create a new customer.", "customer_locked");
  }

  const current = {
    bvn: decryptPii(c.bvn_enc),
    dob: decryptPii(c.dob_enc),
    address: JSON.parse(decryptPii(c.address_enc)) as Address,
    idNumber: decryptPii(c.id_number_enc),
  };
  const next = {
    first_name: b.first_name ?? c.first_name,
    middle_name: b.middle_name === undefined ? c.middle_name : b.middle_name,
    last_name: b.last_name ?? c.last_name,
    email: b.email ?? c.email,
    phone: b.phone !== undefined ? checkPhone(b.phone) : c.phone,
    dob: b.date_of_birth !== undefined ? checkDob(b.date_of_birth) : current.dob,
    bvn: b.bvn ?? current.bvn,
    address: b.address ?? current.address,
    idType: (b.identity?.type ?? c.id_type) as IdentityType,
    idNumber: b.identity?.number ?? current.idNumber,
    front: b.identity ? fileParam(b.identity.document_front, "identity.document_front") : c.id_front_file_id,
    back: b.identity ? fileParam(b.identity.document_back, "identity.document_back") : c.id_back_file_id,
  };
  if (b.identity) {
    if (next.front && next.front !== c.id_front_file_id) await assertIdentityFile(ctx.scope, next.front, "identity.document_front", c.id);
    if (next.back && next.back !== c.id_back_file_id) await assertIdentityFile(ctx.scope, next.back, "identity.document_back", c.id);
  }
  await assertKycRate(ctx.scope);

  // A different person (name, birth date, BVN, contact details) needs a fresh
  // enrolment; a new document alone only retries the document step.
  const personChanged =
    next.first_name !== c.first_name ||
    next.middle_name !== c.middle_name ||
    next.last_name !== c.last_name ||
    next.email !== c.email ||
    next.phone !== c.phone ||
    next.dob !== current.dob ||
    next.bvn !== current.bvn ||
    JSON.stringify(next.address) !== JSON.stringify(current.address);
  const fingerprint = fingerprintPii(next.bvn);

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE dev_customers SET first_name = $2, middle_name = $3, last_name = $4, email = $5, phone = $6,
          dob_enc = $7, address_enc = $8, bvn_enc = $9, bvn_fingerprint = $10, bvn_last4 = $11,
          id_type = $12, id_number_enc = $13, id_front_file_id = $14::uuid, id_back_file_id = $15::uuid,
          metadata = COALESCE($16::jsonb, metadata),
          provider_customer_id = CASE WHEN $17 THEN NULL ELSE provider_customer_id END,
          provider_tier = CASE WHEN $17 THEN 0 ELSE provider_tier END,
          kyc_status = 'pending', kyc_reason = NULL, kyc_attempts = 0, kyc_next_attempt_at = NULL,
          kyc_submitted_at = now(), updated_at = now()
        WHERE id = $1::uuid AND kyc_status = 'rejected'`,
      c.id,
      next.first_name,
      next.middle_name,
      next.last_name,
      next.email,
      next.phone,
      encryptPii(next.dob),
      encryptPii(JSON.stringify(next.address)),
      encryptPii(next.bvn),
      fingerprint,
      next.bvn.slice(-4),
      next.idType,
      encryptPii(next.idNumber),
      next.front,
      next.back,
      b.metadata === undefined ? null : JSON.stringify(b.metadata),
      personChanged,
    );
  } catch (err) {
    await throwForUniqueViolation(err, ctx.scope, fingerprint);
    throw err;
  }
  return { body: customerObject(await startVerification(c.id, ctx.mode)) };
}

/** The sandbox decides at once; live verification runs after the response (the partner can take seconds). */
async function startVerification(customerId: string, mode: Mode): Promise<CustomerRow> {
  if (mode === "test") return runVerification(customerId);
  later(() => runVerification(customerId));
  return (await loadCustomer(customerId))!;
}

// ---- Verification -----------------------------------------------------------

/**
 * Run (or continue) one customer's verification. Claims the attempt first —
 * a short lease on the row — so two runs never verify the same customer at
 * once, and a crash mid-attempt is simply retried when the lease lapses.
 */
export async function runVerification(customerId: string): Promise<CustomerRow> {
  const claimed = await prisma.$queryRawUnsafe<CustomerRow[]>(
    `UPDATE dev_customers SET kyc_attempts = kyc_attempts + 1, kyc_next_attempt_at = now() + interval '${ATTEMPT_LEASE}', updated_at = now()
      WHERE id = $1::uuid AND kyc_status = 'pending' AND (kyc_next_attempt_at IS NULL OR kyc_next_attempt_at <= now())
      RETURNING *`,
    customerId,
  );
  const c = claimed[0];
  if (!c) return (await loadCustomer(customerId))!;
  try {
    return c.mode === "test" ? await verifySandbox(c) : await verifyLive(c);
  } catch (err) {
    console.error("[devapi] verification attempt failed", { customer: c.id, error: err instanceof Error ? err.message : String(err) });
    return scheduleRetry(c, "internal error");
  }
}

async function verifySandbox(c: CustomerRow): Promise<CustomerRow> {
  const bvn = c.bvn_enc ? decryptPii(c.bvn_enc) : "";
  if (bvn === SANDBOX_BVN.rejected) return finishRejected(c, "identity_mismatch");
  if (bvn === SANDBOX_BVN.pending && c.kyc_attempts < 2) {
    const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(
      `UPDATE dev_customers SET kyc_next_attempt_at = now() + make_interval(secs => $2::int) WHERE id = $1::uuid RETURNING *`,
      c.id,
      SANDBOX_PENDING_MS / 1000,
    );
    return rows[0];
  }
  return finishVerified(c, 2);
}

function toProviderDob(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

async function verifyLive(c: CustomerRow): Promise<CustomerRow> {
  const blocked = await prisma.user.findFirst({
    where: { bvnFingerprint: c.bvn_fingerprint, status: { in: [UserStatus.BLOCKED, UserStatus.SUSPENDED] } },
    select: { id: true },
  });
  if (blocked) {
    await alertOpsOnce(
      `devapi-blocked-identity:${c.id}`,
      "🚨 Developer API: a developer submitted a customer whose BVN belongs to a blocked CheqPay user. Verification was declined.",
      { developer_account: c.account_id, customer: toPublicId("customer", c.id) },
    );
    return finishRejected(c, "verification_declined");
  }
  if (!c.bvn_enc || !c.dob_enc || !c.address_enc || !c.id_number_enc) return finishRejected(c, "verification_unavailable");

  const bvn = decryptPii(c.bvn_enc);
  const dob = decryptPii(c.dob_enc);
  const address = JSON.parse(decryptPii(c.address_enc)) as Address;
  const idNumber = decryptPii(c.id_number_enc);
  const origin = publicApiOrigin();
  const imageUrl = c.id_front_file_id && origin ? signDevFileUrl(c.id_front_file_id, 3600, origin) : null;
  const identity = imageUrl ? { type: c.id_type, image: imageUrl, number: idNumber, country: "NG" } : undefined;

  let providerId = c.provider_customer_id;
  let tier = c.provider_tier;
  if (!providerId) {
    try {
      const enrolled = await enrollCustomer({
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        country: "NG",
        identification_number: bvn,
        dob: toProviderDob(dob),
        phone: { phone_country_code: "+234", phone_number: c.phone.slice(1) },
        address: { street: address.street, city: address.city, state: address.state, country: "NG", postal_code: address.postal_code },
        ...(identity ? { identity } : {}),
      });
      providerId = enrolled.id;
      tier = Math.max(1, enrolled.tier ?? 1);
    } catch (err) {
      if (isDefiniteRejection(err)) {
        const detail = describeProviderError(err);
        // "Already exists" isn't the developer's mistake and mustn't tell them
        // the person is enrolled elsewhere; ops sorts it out.
        if (/exist|duplicate|already/i.test(detail)) {
          await alertOpsOnce(
            `devapi-kyc-duplicate:${c.id}`,
            "⚠️ Developer API: the banking partner already holds this customer's identity under another customer. Needs manual linking.",
            { developer_account: c.account_id, customer: toPublicId("customer", c.id) },
          );
          return finishRejected(c, "verification_unavailable", detail);
        }
        return finishRejected(c, "identity_mismatch", detail);
      }
      return scheduleRetry(c, describeProviderError(err));
    }
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE dev_customers SET provider_customer_id = $2, provider_tier = $3, updated_at = now() WHERE id = $1::uuid`,
        c.id,
        providerId,
        tier,
      );
    } catch (err) {
      if (uniqueViolation(err)) {
        await alertOpsOnce(
          `devapi-kyc-provider-dup:${c.id}`,
          "⚠️ Developer API: the banking partner returned a customer that is already linked to another developer customer. Needs manual review.",
          { developer_account: c.account_id, customer: toPublicId("customer", c.id) },
        );
        return finishRejected(c, "verification_unavailable");
      }
      throw err;
    }
  }

  if (tier < 2) {
    if (!identity) return scheduleRetry(c, "no public URL for the identity document");
    try {
      await upgradeCustomerTier2({ customer_id: providerId, identity });
      tier = 2;
    } catch (err) {
      if (isDefiniteRejection(err)) return finishRejected(c, "id_document_rejected", describeProviderError(err));
      return scheduleRetry(c, describeProviderError(err));
    }
  }
  return finishVerified(c, tier);
}

async function finishVerified(c: CustomerRow, tier: number): Promise<CustomerRow> {
  let eventId: string | null = null;
  const row = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<CustomerRow[]>(
      `UPDATE dev_customers SET kyc_status = 'verified', kyc_reason = NULL, verified_at = now(), provider_tier = GREATEST(provider_tier, $2),
          kyc_next_attempt_at = NULL, updated_at = now()
        WHERE id = $1::uuid AND kyc_status = 'pending' RETURNING *`,
      c.id,
      tier,
    );
    if (!rows[0]) return null;
    await ensureCustomerWallets(db, c.account_id, c.mode, c.id);
    eventId = await recordEvent(db, { accountId: c.account_id, mode: c.mode, type: "customer.verified", object: customerObject(rows[0]) });
    return rows[0];
  });
  if (eventId) deliverSoon([eventId]);
  return row ?? (await loadCustomer(c.id))!;
}

async function finishRejected(c: CustomerRow, reason: keyof typeof KYC_REASONS, detail?: string): Promise<CustomerRow> {
  if (detail) {
    console.warn("[devapi] customer not verified", { customer: c.id, reason, detail: scrubSensitive(detail).slice(0, 300) });
  }
  let eventId: string | null = null;
  const row = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<CustomerRow[]>(
      `UPDATE dev_customers SET kyc_status = 'rejected', kyc_reason = $2, kyc_next_attempt_at = NULL, updated_at = now()
        WHERE id = $1::uuid AND kyc_status = 'pending' RETURNING *`,
      c.id,
      reason,
    );
    if (!rows[0]) return null;
    eventId = await recordEvent(db, { accountId: c.account_id, mode: c.mode, type: "customer.rejected", object: customerObject(rows[0]) });
    return rows[0];
  });
  if (eventId) deliverSoon([eventId]);
  if (row && c.mode === "live") {
    const recent = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM dev_customers
        WHERE account_id = $1::uuid AND mode = 'live' AND kyc_status = 'rejected' AND updated_at > now() - interval '1 day'`,
      c.account_id,
    );
    if (Number(recent[0]?.n ?? 0) >= 20) {
      await alertOpsOnce(
        `devapi-kyc-rejections:${c.account_id}`,
        "⚠️ Developer API: 20+ customers rejected at one developer account in 24 hours. Review the account for identity misuse.",
        { developer_account: c.account_id },
      );
    }
  }
  return row ?? (await loadCustomer(c.id))!;
}

async function scheduleRetry(c: CustomerRow, why: string): Promise<CustomerRow> {
  const minutes = RETRY_MINUTES[c.kyc_attempts - 1];
  if (minutes === undefined) {
    await alertOpsOnce(
      `devapi-kyc-gave-up:${c.id}`,
      "⚠️ Developer API: a customer's verification failed on every retry (partner unavailable). It was marked unverifiable; the developer can resubmit.",
      { developer_account: c.account_id, customer: toPublicId("customer", c.id), last_error: scrubSensitive(why).slice(0, 200) },
    );
    return finishRejected(c, "verification_unavailable", why);
  }
  console.warn("[devapi] verification will be retried", { customer: c.id, attempt: c.kyc_attempts, in_minutes: minutes, why: scrubSensitive(why).slice(0, 200) });
  const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(
    `UPDATE dev_customers SET kyc_next_attempt_at = now() + make_interval(mins => $2::int), updated_at = now()
      WHERE id = $1::uuid AND kyc_status = 'pending' RETURNING *`,
    c.id,
    minutes,
  );
  return rows[0] ?? (await loadCustomer(c.id))!;
}

/** Customers whose verification is due again (sandbox minute up, live retry due). */
export async function retryDueVerifications(limit: number): Promise<number> {
  await ensureDevApiSchema();
  const due = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM dev_customers WHERE kyc_status = 'pending' AND kyc_next_attempt_at <= now() ORDER BY kyc_next_attempt_at LIMIT $1`,
    limit,
  );
  for (const d of due) await runVerification(d.id);
  return due.length;
}

/**
 * Sandbox data is test data, but developers do sometimes test with real
 * people's details. After 90 days a sandbox customer's identifying details are
 * erased (the record and its test money history stay), and unused identity
 * uploads are deleted: sandbox ones after 90 days, live ones never attached to
 * a customer after 30.
 */
export async function scrubOldSandboxData(): Promise<{ customers: number; files: number }> {
  await ensureDevApiSchema();
  const customers = await prisma.$executeRawUnsafe(
    `UPDATE dev_customers SET first_name = 'Deleted', middle_name = NULL, last_name = 'Customer', email = '', phone = '',
        dob_enc = NULL, address_enc = NULL, bvn_enc = NULL, id_number_enc = NULL,
        id_front_file_id = NULL, id_back_file_id = NULL, redacted_at = now(), updated_at = now()
      WHERE mode = 'test' AND redacted_at IS NULL AND created_at < now() - interval '90 days'`,
  );
  const files = await prisma.$executeRawUnsafe(
    `DELETE FROM dev_files f
      WHERE f.purpose = 'identity_document'
        AND ((f.mode = 'test' AND f.created_at < now() - interval '90 days')
          OR (f.mode = 'live' AND f.created_at < now() - interval '30 days'))
        AND NOT EXISTS (SELECT 1 FROM dev_customers c WHERE c.id_front_file_id = f.id OR c.id_back_file_id = f.id)`,
  );
  return { customers, files };
}

