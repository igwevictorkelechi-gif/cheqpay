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
 *
 * TWO FOLDERS, ONE LIFECYCLE
 *
 *   kyc/pending/{userId}/…     an upload that has not been sent anywhere
 *   kyc/submitted/{userId}/…   part of a KYC application Maplerad has accepted
 *
 * Everything lands in `pending` and is promoted to `submitted` by the KYC route
 * once enrolment returns a customer id. The point is that an operator looking at
 * the bucket — or anyone reasoning about what has left our systems — can tell
 * the two apart, which a single flat folder could not express.
 *
 * "Submitted" describes the APPLICATION, not each individual byte: Maplerad's
 * identity block takes a single image, so only the front is ever transmitted,
 * but both sides belong to a submission that has happened and both move
 * together. The folder name is not a claim that the back image was sent.
 *
 * Documents uploaded before these folders existed sit at `kyc/{userId}/…`. They
 * are never rewritten — their paths are already recorded on KycRecord rows —
 * and every function here treats them as terminal.
 */

const BUCKET = "kyc-documents";

/** Where uploads land: received, not yet sent to the provider. */
const PENDING_PREFIX = "kyc/pending/";
/** Where they move once the provider has accepted the enrolment. */
const SUBMITTED_PREFIX = "kyc/submitted/";

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
 * The same object's path under the other lifecycle folder, or null when the ref
 * belongs to neither (a legacy `kyc/{userId}/…` path).
 */
function counterpart(path: string): string | null {
  if (path.startsWith(PENDING_PREFIX)) {
    return SUBMITTED_PREFIX + path.slice(PENDING_PREFIX.length);
  }
  if (path.startsWith(SUBMITTED_PREFIX)) {
    return PENDING_PREFIX + path.slice(SUBMITTED_PREFIX.length);
  }
  return null;
}

/**
 * Supabase folders are virtual — a prefix exists only while an object sits under
 * it, so both lifecycle folders would be invisible in the dashboard until the
 * first upload, and `submitted` would stay invisible until the first successful
 * enrolment. A zero-byte marker (the same name the Supabase UI itself uses) puts
 * them on screen from the start.
 *
 * Best-effort by design: this is a convenience for humans reading the bucket, and
 * it must never be the reason a user cannot upload their ID.
 */
async function ensureFolderMarkers(url: string, key: string): Promise<void> {
  for (const prefix of [PENDING_PREFIX, SUBMITTED_PREFIX]) {
    try {
      await fetch(`${url}/storage/v1/object/${BUCKET}/${prefix}.emptyFolderPlaceholder`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/octet-stream",
          // Unlike a document, re-writing this marker is harmless.
          "x-upsert": "true",
        },
        body: new ArrayBuffer(0),
      });
    } catch {
      // Ignored on purpose — see above.
    }
  }
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
  // 409 (already exists) is the expected steady state.
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => "");
    if (!/already exists/i.test(body)) {
      throw new Error(`Could not create the KYC bucket (HTTP ${res.status}): ${body}`);
    }
  }
  await ensureFolderMarkers(url, key);
}

/**
 * Upload one document image into the PENDING folder and return its object PATH
 * (not a URL). The path is what we persist; a URL is minted from it on demand
 * and expires.
 */
export async function uploadKycDocument(
  userId: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const { url, key } = config();
  await ensureKycBucket();
  const path = `${PENDING_PREFIX}${userId}/${randomUUID()}.${extFor(contentType)}`;
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
 * Whose document is this? Returns the user-id segment of a storage ref, or null
 * if the ref is not a well-formed KYC document path.
 *
 * Refs make a round trip through the client — the upload route hands one back
 * and the KYC submission sends it in again — so the KYC route has to check that
 * the caller owns what they are attaching rather than trusting the string. The
 * parsing lives here because this module is what decides the path shape, and all
 * three shapes (pending, submitted, and pre-staging legacy) have to be accepted.
 *
 * A ref must be exactly {prefix}/{userId}/{filename}: any extra segment — a
 * traversal attempt among them — is not a path we ever produced.
 */
export function kycDocumentOwner(ref: string): string | null {
  const rest = ref.startsWith(PENDING_PREFIX)
    ? ref.slice(PENDING_PREFIX.length)
    : ref.startsWith(SUBMITTED_PREFIX)
      ? ref.slice(SUBMITTED_PREFIX.length)
      : ref.startsWith("kyc/")
        ? ref.slice("kyc/".length)
        : null;
  if (rest === null) return null;
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [userId, filename] = parts;
  if (!userId || !filename) return null;
  return userId;
}

/**
 * Promote a staged document out of `pending` and into `submitted`, returning its
 * new path. The caller must persist that path — the object is moved, not copied.
 *
 * A no-op for anything not sitting in `pending`: an already-promoted ref, or a
 * legacy path from before the folders existed. Callers can therefore run this
 * over a whole record's refs without first working out which are eligible.
 */
export async function moveKycDocument(ref: string): Promise<string> {
  if (!ref.startsWith(PENDING_PREFIX)) return ref;
  const destinationKey = SUBMITTED_PREFIX + ref.slice(PENDING_PREFIX.length);
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/move`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: ref, destinationKey }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not move the KYC document (HTTP ${res.status}): ${body}`);
  }
  return destinationKey;
}

async function signOnce(
  url: string,
  key: string,
  path: string,
  ttlSeconds: number
): Promise<string> {
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

/**
 * Mint a time-limited HTTPS URL for a stored object. Used at enrolment to give
 * Maplerad something it can fetch once, and by the admin user page to show a
 * reviewer the images; kept short so a leaked URL expires fast.
 *
 * If the stored path misses, the other lifecycle folder is tried once. A ref and
 * the object can legitimately fall out of step — the move succeeds and the
 * database write that records the new path does not — and the cost of not
 * retrying is an admin reviewer staring at a blank document panel with no way to
 * tell a missing file from a moved one.
 */
export async function signKycDocument(
  path: string,
  ttlSeconds: number
): Promise<string> {
  const { url, key } = config();
  try {
    return await signOnce(url, key, path, ttlSeconds);
  } catch (err) {
    const other = counterpart(path);
    if (!other) throw err;
    try {
      return await signOnce(url, key, other, ttlSeconds);
    } catch {
      // Report the failure for the path we were actually asked about.
      throw err;
    }
  }
}
