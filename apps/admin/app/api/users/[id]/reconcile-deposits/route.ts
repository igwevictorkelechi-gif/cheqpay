import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend deposit reconciliation. The admin secret
// stays on the server, same as the other proxies in this directory.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/reconcile-deposits`, {
    method: "GET",
    headers: await adminHeaders({
    }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/users/${id}/reconcile-deposits`, {
    method: "POST",
    headers: await adminHeaders({
      "content-type": "application/json",
    }),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
