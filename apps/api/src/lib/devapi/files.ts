// apps/api/src/lib/devapi/files.ts
//
// Uploaded documents: a business's registration certificate now, customers'
// identity documents later. Stored encrypted with the PII key, so a database
// copy on its own discloses none of them. The content type is checked against
// the file's first bytes, not trusted from the uploader.

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { matchesSignature } from "../fileSignature";
import { decryptPiiBytes, encryptPiiBytes, isPiiEncryptionConfigured } from "../pii";
import { ensureDevApiSchema } from "./ensureDevApi";
import type { Mode } from "./types";

export const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type FileType = (typeof FILE_TYPES)[number];
export type FilePurpose = "business_document" | "identity_document" | "selfie";

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

export async function storeDevFile(input: {
  accountId: string;
  mode: Mode;
  purpose: FilePurpose;
  bytes: Buffer;
  contentType: string;
}): Promise<string> {
  assertPiiReady();
  await ensureDevApiSchema();
  if (!(FILE_TYPES as readonly string[]).includes(input.contentType)) {
    throw new ApiError(400, "Upload a JPG, PNG or PDF.", "validation_error");
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_FILE_BYTES) {
    throw new ApiError(413, "Files can be at most 3 MB.", "body_too_large");
  }
  if (!matchesSignature(input.bytes, input.contentType)) {
    throw new ApiError(400, "That file isn't the type it claims to be.", "file_type_mismatch");
  }
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
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
