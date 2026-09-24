import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin virtual-accounts endpoint.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const search = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/virtual-accounts${search}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
