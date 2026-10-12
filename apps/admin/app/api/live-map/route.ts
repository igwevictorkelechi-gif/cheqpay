import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend live-map endpoint (the admin API secret
// stays on the server). Passes only the `since` cursor through.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get("since");
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${API_URL}/api/admin/live-map${qs}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
