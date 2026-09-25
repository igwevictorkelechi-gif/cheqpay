import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend broadcast endpoint. adminHeaders() carries
// the signed-in admin's identity and the authenticator code SecurityGate adds.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = await fetch(`${API_URL}/api/admin/broadcast`, {
    method: "POST",
    headers: await adminHeaders({ "content-type": "application/json" }),
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
