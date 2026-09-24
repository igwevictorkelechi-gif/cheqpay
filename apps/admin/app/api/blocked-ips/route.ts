import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend IP blocklist.
export const dynamic = "force-dynamic";

async function forward(method: "GET" | "POST" | "DELETE", body?: string) {
  const res = await fetch(`${API_URL}/api/admin/blocked-ips`, {
    method,
    headers: await adminHeaders(body ? { "content-type": "application/json" } : {}),
    ...(body ? { body } : {}),
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

export async function DELETE(req: Request) {
  return forward("DELETE", await req.text());
}
