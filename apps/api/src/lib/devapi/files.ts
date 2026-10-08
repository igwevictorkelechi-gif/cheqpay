// apps/api/src/lib/devapi/files.ts
//
// Uploaded documents: a business's registration certificate now, customers'
// identity documents later. Stored encrypted with the PII key, so a database
// copy on its own discloses none of them. The content type is checked against
// the file's first bytes, not trusted from the uploader.

import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { toPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { matchesSignature } from "../fileSignature";
import { decryptPiiBytes, encryptPiiBytes, fingerprintMatches, fingerprintPii, isPiiEncryptionConfigured } from "../pii";
import { ensureDevApiSchema } from "./ensureDevApi";
import type { Mode } from "./types";

export const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type FileType = (typeof FILE_TYPES)[number];
export type FilePurpose = "business_document" | "identity_document" | "selfie";

/** Identity documents go to the verification partner as images, so no PDFs. */
export const IDENTITY_FILE_TYPES = ["image/jpeg", "image/png"] as const;

/** 3 MB: a JSON upload carries it as base64, which must fit the platform's 4.5 MB request cap. */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export function assertPiiReady(): void {
  if (!isPiiEncryptionConfigured()) {
    throw new ApiError(503, "Document storage isn't available right now. Please try again later.", "pii_not_configured");
  }
}

/** Decode a `data:<type>;base64,<…>` upload, checking its type and size. */
export function decodeDataUrl(value: unknown): { bytes: Buffer; contentType: FileType } {
  const m = typeof value === "string" ? /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value) : null;
  if (!m || !(FILE_TYPES as readonly string[]).includes(m[1])) {
    throw new ApiError(400, "Upload a JPG, PNG or PDF.", "validation_error");
  }
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    throw new ApiError(413, "Files can be at most 3 MB.", "body_too_large");
  }
  return { bytes, contentType: m[1] as FileType };
}

/** Refuse a file that isn't an allowed type, is empty or too big, or isn't what it claims to be. */
export function assertUploadable(bytes: Buffer, contentType: string, allowed: readonly string[] = FILE_TYPES): void {
  if (!allowed.includes(contentType)) {
    throw new ApiError(400, allowed.includes("application/pdf") ? "Upload a JPG, PNG or PDF." : "Upload a JPG or PNG image.", "validation_error");
  }
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    throw new ApiError(413, "Files can be at most 3 MB.", "body_too_large");
  }
  if (!matchesSignature(bytes, contentType)) {
    throw new ApiError(400, "That file isn't the type it claims to be.", "file_type_mismatch");
  }
}

export async function storeDevFile(
  input: {
    accountId: string;
    mode: Mode;
    purpose: FilePurpose;
    bytes: Buffer;
    contentType: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  assertPiiReady();
  await ensureDevApiSchema();
  assertUploadable(input.bytes, input.contentType, input.purpose === "business_document" ? FILE_TYPES : IDENTITY_FILE_TYPES);
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO dev_files (id, account_id, mode, purpose, content_type, size_bytes, sha256, data_enc)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
    id,
    input.accountId,
    input.mode,
    input.purpose,
    input.contentType,
    input.bytes.length,
    createHash("sha256").update(input.bytes).digest("hex"),
    encryptPiiBytes(input.bytes),
  );
  return id;
}

/** Decrypt a stored file. Callers decide who may see it (admins, the provider via a signed URL). */
export async function readDevFile(fileId: string): Promise<{ contentType: string; bytes: Buffer; accountId: string } | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<{ content_type: string; data_enc: Buffer; account_id: string }[]>(
    `SELECT content_type, data_enc, account_id FROM dev_files WHERE id = $1::uuid`,
    fileId,
  );
  const row = rows[0];
  if (!row) return null;
  return { contentType: row.content_type, bytes: decryptPiiBytes(Buffer.from(row.data_enc)), accountId: row.account_id };
}

export interface DevFileMeta {
  id: string;
  account_id: string;
  mode: Mode;
  purpose: FilePurpose;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

/** A file's details (never its bytes), only if it belongs to this account and mode. */
export async function getDevFileMeta(scope: { accountId: string; mode: Mode }, fileId: string): Promise<DevFileMeta | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<DevFileMeta[]>(
    `SELECT id, account_id, mode, purpose, content_type, size_bytes, created_at FROM dev_files
      WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    fileId,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export function fileObject(f: DevFileMeta) {
  return {
    object: "file",
    id: toPublicId("file", f.id),
    purpose: f.purpose,
    content_type: f.content_type,
    size: f.size_bytes,
    livemode: f.mode === "live",
    created_at: f.created_at.toISOString(),
  };
}

/**
 * Read an upload from a /v1/files request: multipart/form-data with `purpose`
 * and `file` fields, or JSON with `purpose` and a `file` data URL. The body is
 * read with a hard byte cap, so an oversized upload is cut off rather than
 * buffered whole.
 */
export async function readUpload(req: Request, maxBytes: number): Promise<{ purpose: string; bytes: Buffer; contentType: string }> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "multipart/form-data" && type !== "application/json") {
    throw new ApiError(415, "Upload with Content-Type: multipart/form-data (or JSON with a data URL).", "unsupported_media_type");
  }
  const raw = await readCapped(req, maxBytes);
  if (type === "application/json") {
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new ApiError(400, "The request body is not valid JSON.", "invalid_json");
    }
    const b = (body ?? {}) as { purpose?: unknown; file?: unknown };
    const { bytes, contentType } = decodeDataUrl(b.file);
    return { purpose: typeof b.purpose === "string" ? b.purpose : "", bytes, contentType };
  }
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(raw), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new ApiError(400, "The multipart body couldn't be read.", "validation_error");
  }
  const file = form.get("file");
  const purpose = form.get("purpose");
  if (!file || typeof file === "string") throw new ApiError(400, "Attach the document as the `file` field.", "validation_error");
  return {
    purpose: typeof purpose === "string" ? purpose : "",
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type.toLowerCase(),
  };
}

async function readCapped(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError(413, "Files can be at most 3 MB.", "body_too_large");
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "Files can be at most 3 MB.", "body_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ---- Signed links for the verification partner ----------------------------
//
// The partner fetches a customer's ID image once, during verification, from a
// short-lived URL whose signature is the only authorization — the same model
// as the app's own KYC documents (lib/kycDocuments.ts), with its own HMAC
// domain so a token for one can never open the other.

const TOKEN_DOMAIN = "devfile";

function tokenPayload(fileId: string, exp: number): string {
  return `${TOKEN_DOMAIN}:${fileId}:${exp}`;
}

/** Where this API is publicly reachable, for URLs someone else must fetch. Null when unknown. */
export function publicApiOrigin(): string | null {
  const explicit = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

export function signDevFileUrl(fileId: string, ttlSeconds: number, origin: string): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = fingerprintPii(tokenPayload(fileId, exp));
  return `${origin.replace(/\/$/, "")}/api/dev-files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyDevFileToken(fileId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  try {
    return fingerprintMatches(sig, fingerprintPii(tokenPayload(fileId, exp)));
  } catch {
    return false;
  }
}

/** An identity document's bytes for the signed-link route (never business documents). */
export async function readIdentityDocument(fileId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<{ content_type: string; data_enc: Buffer }[]>(
    `SELECT content_type, data_enc FROM dev_files WHERE id = $1::uuid AND purpose = 'identity_document'`,
    fileId,
  );
  const row = rows[0];
  if (!row) return null;
  return { contentType: row.content_type, bytes: decryptPiiBytes(Buffer.from(row.data_enc)) };
}
