import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/api/admin/ads/screens/${encodeURIComponent(id)}`, "DELETE");
}
