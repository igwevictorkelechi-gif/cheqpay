import { randomUUID } from "node:crypto";

/**
 * Private object storage for KYC documents, on Supabase Storage.
 *
 * We already use Supabase for auth, so its Storage REST API is reachable with
 * the service-role key we hold — no new vendor. Documents live in a PRIVATE
 * bucket: nothing is world-readable, and the only way out is a short-lived
 * signed URL we mint at enrolment time and hand to Maplerad to fetch once.
 *
 * The service-role key bypasses row-level security, so this module must only
 * ever run server-side (it does — API routes only) and must never echo the key.
 */

const BUCKET = "kyc-documents";

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "KYC document storage is not configured: SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  }
  return { url, key };
}

function extFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  return "jpg"; // image/jpeg and anything else we accept
}

/**
 * Create the private bucket if it does not exist. Idempotent: a second call, or
 * a bucket someone made by hand, is not an error.
 */
export async function ensureKycBucket(): Promise<void> {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok) return;
  // 409 (already exists) is the expected steady state.
  if (res.status === 409) return;
  const body = await res.text().catch(() => "");
  if (/already exists/i.test(body)) return;
  throw new Error(`Could not create the KYC bucket (HTTP ${res.status}): ${body}`);
}

/**
 * Upload one document image and return its object PATH (not a URL). The path is
 * what we persist; a URL is minted from it on demand and expires.
 */
export async function uploadKycDocument(
  userId: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const { url, key } = config();
  await ensureKycBucket();
  const path = `kyc/${userId}/${randomUUID()}.${extFor(contentType)}`;
  // Copy into a freshly allocated ArrayBuffer so it is a valid BodyInit under
  // the DOM fetch types (a Node Buffer's backing store is typed as the wider
  // ArrayBufferLike). The Content-Type header is authoritative for storage.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      // Never overwrite: each upload is a fresh uuid, so a collision is a bug.
      "x-upsert": "false",
    },
    body: ab,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`KYC document upload failed (HTTP ${res.status}): ${body}`);
  }
  return path;
}

/**
 * Mint a time-limited HTTPS URL for a stored object. Used at enrolment to give
 * Maplerad something it can fetch once; kept short so a leaked URL expires fast.
 */
export async function signKycDocument(
  path: string,
  ttlSeconds: number
): Promise<string> {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: ttlSeconds }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not sign the KYC document (HTTP ${res.status}): ${body}`);
  }
  const json = (await res.json()) as { signedURL?: string };
  if (!json.signedURL) {
    throw new Error("Supabase returned no signedURL for the KYC document");
  }
  // signedURL is a root-relative path like "/object/sign/kyc-documents/...".
  return `${url}/storage/v1${json.signedURL}`;
}
