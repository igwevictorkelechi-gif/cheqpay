import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Alerts on this dashboard: the push key, and turning alerts on or off for the
// signed-in admin's browser.

export const dynamic = "force-dynamic";

async function forward(method: "GET" | "POST" | "DELETE", query: string, body?: string, ua?: string | null) {
  const res = await fetch(`${API_URL}/api/admin/push${query}`, {
    method,
    headers: await adminHeaders({
      ...(body ? { "content-type": "application/json" } : {}),
      ...(ua ? { "user-agent": ua.slice(0, 300) } : {}),
    }),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  return forward("GET", endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "");
}

export async function POST(req: Request) {
  return forward("POST", "", await req.text(), req.headers.get("user-agent"));
}

export async function DELETE(req: Request) {
  return forward("DELETE", "", await req.text());
}
