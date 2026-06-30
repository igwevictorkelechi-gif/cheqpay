import { NextResponse } from "next/server";

// Server-side proxy to the backend admin settings endpoint. The admin API
// secret stays on the server and is never exposed to the browser.
const API_URL = process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app";
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/settings`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/settings`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": ADMIN_SECRET,
      "x-admin-actor": "admin-dashboard",
    },
    body,
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
