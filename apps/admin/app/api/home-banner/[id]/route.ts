import { forwardBanner } from "@/lib/bannerProxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return forwardBanner(req, `/${encodeURIComponent(id)}`, "PUT");
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return forwardBanner(req, `/${encodeURIComponent(id)}`, "DELETE");
}
