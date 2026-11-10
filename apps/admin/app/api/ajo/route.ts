import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** Proxy: the Ajo overview. */
export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/ajo`, { headers: await adminHeaders(), cache: "no-store" });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
