import { createHash } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { V1Error, withApi } from "@/lib/devapi/handler";
import { fileObject, getDevFileMeta, readUpload, storeDevFile } from "@/lib/devapi/files";
import { runIdempotent } from "@/lib/devapi/idempotency";

export const dynamic = "force-dynamic";

/** 3 MB of file, plus room for base64 or multipart framing; under the platform's 4.5 MB cap. */
const MAX_UPLOAD = 4_400_000;

/**
 * Upload an identity document (JPG or PNG, up to 3 MB) to attach to a customer.
 * Multipart (`purpose`, `file`) or JSON with a data URL. Stored encrypted; the
 * API never returns a file's contents.
 */
export const POST = withApi({ scope: "files:write", rawBody: true, maxBodyBytes: MAX_UPLOAD }, async (ctx) => {
  const upload = await readUpload(ctx.request, MAX_UPLOAD);
  if (upload.purpose !== "identity_document") {
    throw new V1Error(400, "purpose must be identity_document.", "validation_error", "purpose");
  }
  const pace = await checkRateLimit(`devapi:files:${ctx.scope.accountId}:${ctx.mode}`, 300, 60 * 60_000);
  if (!pace.allowed) {
    throw new V1Error(429, "Too many uploads this hour. Slow down and retry.", "rate_limited", null, Math.max(1, Math.ceil((pace.resetAt - Date.now()) / 1000)));
  }
  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");
  return runIdempotent(ctx, { purpose: upload.purpose, content_type: upload.contentType, sha256 }, {
    replay: async (id) => ({ status: 201, body: fileObject((await getDevFileMeta(ctx.scope, id))!) }),
    work: async (complete) => {
      const id = await prisma.$transaction(async (db) => {
        const fileId = await storeDevFile(
          { accountId: ctx.scope.accountId, mode: ctx.scope.mode, purpose: "identity_document", bytes: upload.bytes, contentType: upload.contentType },
          db,
        );
        await complete(db, "file", fileId, 201);
        return fileId;
      });
      return { status: 201, body: fileObject((await getDevFileMeta(ctx.scope, id))!) };
    },
  });
});
