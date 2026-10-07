import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "PENDING_REVIEW";
  return forward(req, `/api/admin/ads/campaigns?status=${encodeURIComponent(status)}`, "GET");
}
