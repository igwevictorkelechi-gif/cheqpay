import { readGiftCardFile, verifyGiftCardFileToken } from "@/lib/giftCards";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Serve one gift card photo over a short-lived signed URL, for the admin
 * reviewer's browser. The signature is the authorization (minted only by the
 * admin trade view); a bad or expired one looks exactly like "no such file".
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyGiftCardFileToken(id, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "")) {
      return new Response("Not found", { status: 404 });
    }
    const file = await readGiftCardFile(id);
    if (!file) return new Response("Not found", { status: 404 });
    const body = new ArrayBuffer(file.data.byteLength);
    new Uint8Array(body).set(file.data);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Content-Length": String(file.data.byteLength),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
