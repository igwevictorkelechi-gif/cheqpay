import { toErrorResponse } from "@/lib/http";
import { readIdentityDocument, verifyDevFileToken } from "@/lib/devapi/files";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One developer customer's identity document, over a short-lived signed URL.
 *
 * PUBLIC on purpose: our verification partner fetches the image from here once
 * during a customer's verification and can't carry our session, so the URL's
 * signature (minted by lib/devapi/files, its own HMAC domain) is the only
 * authorization. A bad or expired token looks exactly like a missing file.
 * Only identity documents are served — never business registration documents.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    if (!/^[0-9a-f-]{36}$/.test(id) || !verifyDevFileToken(id, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "")) {
      return new Response("Not found", { status: 404 });
    }
    const doc = await readIdentityDocument(id);
    if (!doc) return new Response("Not found", { status: 404 });
    const body = new ArrayBuffer(doc.bytes.byteLength);
    new Uint8Array(body).set(doc.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": doc.contentType,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Content-Length": String(doc.bytes.byteLength),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
