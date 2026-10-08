import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  return forward(req, `/api/admin/developers${status ? `?status=${encodeURIComponent(status)}` : ""}`, "GET");
}
