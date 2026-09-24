import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin settings endpoint. The admin API
// secret stays on the server and is never exposed to the browser.

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/settings`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/settings`, {
    method: "PUT",
    headers: await adminHeaders({
      "content-type": "application/json",
    }),
    body,
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
