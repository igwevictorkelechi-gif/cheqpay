import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// A sub admin's own authenticator: whether it's set up, and setting it up.

export const dynamic = "force-dynamic";

async function forward(method: "GET" | "POST", body?: string) {
  const res = await fetch(`${API_URL}/api/admin/me/otp`, {
    method,
    headers: await adminHeaders(body ? { "content-type": "application/json" } : {}),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function GET() {
  return forward("GET");
}

export async function POST(req: Request) {
  return forward("POST", await req.text());
}
