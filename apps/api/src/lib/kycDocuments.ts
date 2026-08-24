import { prisma } from "@cheqpay/db";
import { fingerprintPii, fingerprintMatches } from "./pii";

/**
 * KYC ID-document images, stored in our own Postgres — not in object storage.
 *
 * The bytes live in a dedicated table, `kyc_document_files`, that is reached
 * ONLY through the raw SQL in this module and is deliberately NOT a Prisma
 * model. That is the whole point of the isolation: Prisma selects every column a
 * model declares on every query of that model, so a 3 MB `bytea` on any modelled
 * table would be dragged into unrelated reads — the exact shape of the outage
 * that a lazily-added column caused before. A table Prisma does not know about
 * cannot be selected by accident.
 *
 * Maplerad needs a fetchable URL for the front image during enrolment, and an
 * admin reviewer needs to see both images in a browser. Neither can read our
 * database, so this module also mints short-lived, HMAC-signed URLs that point
 * back at our own public API (`GET /api/kyc/documents/{id}`), which verifies the
 * signature and streams the bytes. Possession of a valid, unexpired URL is the
 * authorization — the same capability-URL model the signed bucket URLs used,
 * with the store moved in-house.
 *
 * TWO LIFECYCLE STATES, one row:
 *   submitted_at IS NULL   uploaded, not yet sent to Maplerad  (the staging state)
 *   submitted_at set       part of an enrolment Maplerad accepted
 * The row never moves; only the flag flips. This preserves the "held before we
 * send it" distinction the folders expressed, without a second location.
 */

/** Ref shape handed to clients and stored on KycRecord: kyc/{userId}/{docId}. */
const REF_PREFIX = "kyc/";

/** Domain separation so a KYC-document token can never be another HMAC's twin. */
const TOKEN_DOMAIN = "kycdoc";

let ensured: Promise<void> | null = null;
/**
 * Create the document table if it is not there yet — migrations are not applied
 * on deploy in this project. This is a NEW TABLE, not a column on an existing
 * model, so it is safe to run lazily: nothing else selects it. (It is also wired
 * into instrumentation.ts at boot, for warmth, not correctness.)
 */
export function ensureKycDocumentStore(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS kyc_document_files (
          id            UUID PRIMARY KEY,
          user_id       TEXT NOT NULL,
          content_type  TEXT NOT NULL,
          data          BYTEA NOT NULL,
          submitted_at  TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/**
 * Store one image and return its ref (kyc/{userId}/{docId}). The ref — not a URL
 * — is what the client sends back in the KYC submission and what the KycRecord
 * keeps; a URL is minted from it on demand and expires.
 */
export async function storeKycDocument(
  userId: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  await ensureKycDocumentStore();
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO kyc_document_files (id, user_id, content_type, data)
    VALUES (${id}::uuid, ${userId}, ${contentType}, ${bytes})`;
  return `${REF_PREFIX}${userId}/${id}`;
}

/**
 * Whose document is this, and which row? Returns the owning user id and the doc
 * id parsed out of a ref, or null if the ref is not a well-formed KYC path.
 *
 * Refs make a round trip through the client — the upload route hands one back and
 * the KYC submission sends it in again — so callers check the caller owns what
 * they are attaching rather than trusting the string. A ref must be exactly
 * kyc/{userId}/{docId}: any extra segment (a traversal attempt among them) is not
 * a path we ever produced.
 */
export function parseKycRef(ref: string): { userId: string; docId: string } | null {
  if (!ref.startsWith(REF_PREFIX)) return null;
  const parts = ref.slice(REF_PREFIX.length).split("/");
  if (parts.length !== 2) return null;
  const [userId, docId] = parts;
  if (!userId || !docId) return null;
  return { userId, docId };
}

/** Convenience: just the owner, for the ownership check in the KYC route. */
export function kycDocumentOwner(ref: string): string | null {
  return parseKycRef(ref)?.userId ?? null;
}

/**
 * Mark a document as sent to the provider. No-op for a ref we cannot parse or a
 * row that does not exist, so callers can run it over a whole record's refs
 * without first working out which are eligible.
 */
export async function markKycDocumentSubmitted(ref: string): Promise<void> {
  const parsed = parseKycRef(ref);
  if (!parsed) return;
  await ensureKycDocumentStore();
  await prisma.$executeRaw`
    UPDATE kyc_document_files SET submitted_at = now()
    WHERE id = ${parsed.docId}::uuid AND submitted_at IS NULL`;
}

/** The bytes and type for one document id, or null when there is no such row. */
export async function readKycDocument(
  docId: string
): Promise<{ contentType: string; data: Buffer } | null> {
  await ensureKycDocumentStore();
  const rows = await prisma.$queryRaw<Array<{ content_type: string; data: Buffer }>>`
    SELECT content_type, data FROM kyc_document_files WHERE id = ${docId}::uuid`;
  const row = rows[0];
  if (!row) return null;
  return { contentType: row.content_type, data: Buffer.from(row.data) };
}

/** The signed message a token authenticates: this document, until this instant. */
function tokenPayload(docId: string, exp: number): string {
  return `${TOKEN_DOMAIN}:${docId}:${exp}`;
}

/**
 * Build a short-lived, signed URL a browser or Maplerad can GET. Absolute, so it
 * is reachable from off our origin. May throw if the signing key is unavailable
 * — callers treat that as "no image this time" rather than failing the KYC.
 */
export function signKycDocumentUrl(ref: string, ttlSeconds: number, origin: string): string {
  const parsed = parseKycRef(ref);
  if (!parsed) throw new Error(`Not a KYC document ref: ${ref}`);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = fingerprintPii(tokenPayload(parsed.docId, exp));
  const base = origin.replace(/\/$/, "");
  return `${base}/api/kyc/documents/${parsed.docId}?exp=${exp}&sig=${sig}`;
}

/**
 * True when `sig` authenticates `docId` and the URL has not expired. Constant
 * time in the signature comparison; the expiry is checked first so an expired
 * token is rejected without a key being needed.
 */
export function verifyKycDocumentToken(docId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  try {
    return fingerprintMatches(sig, fingerprintPii(tokenPayload(docId, exp)));
  } catch {
    // No usable signing key — nothing can be verified, so nothing is served.
    return false;
  }
}

/**
 * Resolve the public origin of this API, for building URLs others must fetch.
 * An explicit PUBLIC_API_URL wins; then Vercel's production URL; then the
 * request's own forwarded host. Kept here so every minted URL agrees.
 */
export function resolveApiOrigin(req: Request): string {
  const explicit = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
