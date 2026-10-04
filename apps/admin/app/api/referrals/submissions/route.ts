import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const s = new URL(req.url).searchParams.get("status") ?? "PENDING";
  return forward(req, `/api/admin/referrals/submissions?status=${encodeURIComponent(s)}`, "GET");
}
