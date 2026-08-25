import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

// Server-side proxy to the backend USD-account admin endpoint. The admin secret
// stays on the server, same as the other proxies in this directory.
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function headers() {
  return {
    "content-type": "application/json",
    "x-admin-secret": ADMIN_SECRET,
    "x-admin-actor": "admin-dashboard",
  };
}

/** Where the user's USD account stands (stored account + a live status poll). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/usd-account`, {
    headers: headers(),
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
    headers: headers(),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
