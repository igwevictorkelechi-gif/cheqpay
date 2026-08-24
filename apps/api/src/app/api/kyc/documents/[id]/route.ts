import { toErrorResponse } from "@/lib/http";
import { readKycDocument, verifyKycDocumentToken } from "@/lib/kycDocuments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Serve one KYC ID image over a short-lived, signed URL.
 *
 * PUBLIC on purpose: Maplerad fetches the front image from here once during
 * enrolment, and an admin reviewer's browser loads both in an <img>. Neither can
 * carry our session, so the URL's own signature is the authorization — a valid,
 * unexpired `sig` for exactly this `id`, minted by lib/kycDocuments. A missing or
 * bad token is indistinguishable from "no such document": both return 404, so a
 * probe cannot tell an unsigned guess from a wrong id.
 *
 * The bytes live in our Postgres, not in object storage — see lib/kycDocuments.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";

    if (!verifyKycDocumentToken(id, exp, sig)) {
      return new Response("Not found", { status: 404 });
    }

    const doc = await readKycDocument(id);
    if (!doc) {
      return new Response("Not found", { status: 404 });
    }

    const body = new ArrayBuffer(doc.data.byteLength);
    new Uint8Array(body).set(doc.data);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": doc.contentType,
        // Private and uncacheable: a KYC document must not sit in a shared cache,
        // and the URL is single-purpose and short-lived anyway.
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Length": String(doc.data.byteLength),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
