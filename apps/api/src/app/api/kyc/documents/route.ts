import { matchesSignature } from "@/lib/fileSignature";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { kycDocumentUploadSchema } from "@/lib/validation";
import { storeKycDocument } from "@/lib/kycDocuments";

export const dynamic = "force-dynamic";

// Decoded image size cap. Base64 inflates ~33%, so ~3 MB decoded stays well
// under Vercel's request-body limit even with the JSON envelope. Clients should
// downscale before uploading; this is the backstop.
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Upload one government-ID image (front or back) for KYC. Returns the storage
 * PATH (a ref), which the client then sends back in the KYC submission's
 * `identity` block. The image itself never becomes public — it lives in a
 * Postgres and is only ever reached through a short-lived, signed URL minted
 * server-side (for Maplerad at enrolment, and for the admin reviewer on demand).
 *
 * The stored row starts unsubmitted — received, not sent anywhere — and is
 * marked submitted once the KYC submission it belongs to has been accepted by
 * Maplerad. See lib/kycDocuments.ts.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    // Tight: a handful of ID images per user per window, not a firehose.
    await enforceRateLimit(`kyc-doc:${auth.id}`, 20, 60_000);

    const body = kycDocumentUploadSchema.parse(await req.json());

    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.image, "base64");
    } catch {
      throw new ApiError(400, "Image is not valid base64", "bad_image");
    }
    if (bytes.length === 0) {
      throw new ApiError(400, "Image is empty", "bad_image");
    }
    if (bytes.length > MAX_BYTES) {
      throw new ApiError(
        413,
        "Image is too large — please upload one under 3 MB",
        "image_too_large"
      );
    }

    if (!matchesSignature(bytes, body.contentType)) {
      throw new ApiError(
        415,
        "That file isn't a real JPEG or PNG image — please upload a photo of your ID",
        "bad_image"
      );
    }
    // A daily ceiling on top of the per-minute one, so the document store
    // can't be filled up by one account.
    await enforceRateLimit(`kyc-doc-day:${auth.id}`, 10, 24 * 60 * 60_000);

    const ref = await storeKycDocument(auth.id, bytes, body.contentType);
    return jsonOk({ ref, side: body.side }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
