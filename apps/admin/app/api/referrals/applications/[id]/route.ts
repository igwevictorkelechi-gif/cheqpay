import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/api/admin/referrals/applications/${encodeURIComponent(id)}`, "POST");
}
