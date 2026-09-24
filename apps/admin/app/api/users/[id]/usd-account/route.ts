import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend USD-account admin endpoint. The admin secret
// stays on the server, same as the other proxies in this directory.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function headers() {
  return adminHeaders({ "content-type": "application/json" });
}

/** Where the user's USD account stands (stored account + a live status poll). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/usd-account`, {
    headers: await headers(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

/** Manually open the user's USD account from the supplied US-banking KYC. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/users/${id}/usd-account`, {
    method: "POST",
    headers: await headers(),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
