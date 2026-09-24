import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin-credentials endpoint. The admin API
// secret stays on the server. The middleware already ensures the caller has a
// valid admin session before this route runs.

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/credentials`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/credentials`, {
    method: "PATCH",
    headers: await adminHeaders({ "Content-Type": "application/json" }),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
