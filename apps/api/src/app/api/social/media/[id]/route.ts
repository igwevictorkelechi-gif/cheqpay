import { verifyMediaSig } from "@/lib/social/mediaProxy";
import { downloadObject } from "@/lib/social/storage";
import { mediaById } from "@/lib/social/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public, signed and expiring: a scheduled IMAGE served from our own domain,
 * for platforms (TikTok) that only pull from a verified domain. Images only —
 * capped at 4 MB, under the function response limit.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyMediaSig(id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Not found", { status: 404 });
  }
  const media = await mediaById(id).catch(() => null);
  if (!media || media.kind !== "image") return new Response("Not found", { status: 404 });
  const bytes = await downloadObject(media.storagePath);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": media.mime, "content-length": String(bytes.length), "cache-control": "private, max-age=3600" },
  });
}
