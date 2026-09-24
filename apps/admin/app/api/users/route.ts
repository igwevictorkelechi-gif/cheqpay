import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin users endpoint. The admin API secret
// stays on the server and is never exposed to the browser.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/users${qs}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
