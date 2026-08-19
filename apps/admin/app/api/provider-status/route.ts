import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

// Server-side proxy to the backend admin provider-status endpoint.
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/provider-status`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  // Surface the API origin so pages can display the exact webhook URLs to
  // register with providers (the client doesn't otherwise know it).
  if (res.ok && data && typeof data === "object") {
    (data as Record<string, unknown>).apiBaseUrl = API_URL;
  }
  return NextResponse.json(data, { status: res.status });
}
