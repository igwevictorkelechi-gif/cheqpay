import { NextResponse } from "next/server";

// Server-side proxy to the backend admin-credentials endpoint. The admin API
// secret stays on the server. The middleware already ensures the caller has a
// valid admin session before this route runs.
const API_URL = process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app";
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/credentials`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/credentials`, {
    method: "PATCH",
    headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
