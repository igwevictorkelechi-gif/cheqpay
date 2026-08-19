import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

// Server-side proxy to the backend admin stats endpoint. The admin API secret
// stays on the server and is never exposed to the browser.
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/stats`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
