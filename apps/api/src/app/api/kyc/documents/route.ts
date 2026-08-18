import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { kycDocumentUploadSchema } from "@/lib/validation";
import { uploadKycDocument } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Decoded image size cap. Base64 inflates ~33%, so ~3 MB decoded stays well
// under Vercel's request-body limit even with the JSON envelope. Clients should
// downscale before uploading; this is the backstop.
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Upload one government-ID image (front or back) for KYC. Returns the storage
 * PATH (a ref), which the client then sends back in the KYC submission's
 * `identity` block. The image itself never becomes public — it lives in a
 * private bucket and is only ever reached through a short-lived signed URL minted
 * server-side at enrolment. See lib/storage.ts.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    // Tight: a handful of ID images per user per window, not a firehose.
    enforceRateLimit(`kyc-doc:${auth.id}`, 20, 60_000);

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

    const ref = await uploadKycDocument(auth.id, bytes, body.contentType);
    return jsonOk({ ref, side: body.side }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
