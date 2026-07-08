import { NextResponse } from "next/server";

// Server-side proxy to the backend admin balance-adjustment endpoint.
const API_URL = process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app";
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/adjust-balance`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET, "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
