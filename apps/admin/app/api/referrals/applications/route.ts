import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const out = new URLSearchParams({ status: q.get("status") ?? "PENDING", q: q.get("q") ?? "" });
  return forward(req, `/api/admin/referrals/applications?${out}`, "GET");
}
