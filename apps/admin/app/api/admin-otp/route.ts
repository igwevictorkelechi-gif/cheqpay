import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin OTP endpoint.

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/otp`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/otp`, {
    method: "POST",
    headers: await adminHeaders({ "content-type": "application/json" }),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
