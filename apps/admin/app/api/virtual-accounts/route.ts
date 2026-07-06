import { NextResponse } from "next/server";

// Server-side proxy to the backend admin virtual-accounts endpoint.
const API_URL = process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app";
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const search = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/virtual-accounts${search}`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
