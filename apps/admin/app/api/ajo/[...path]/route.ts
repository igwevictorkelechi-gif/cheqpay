import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** Proxy: /api/ajo/<groups|groups/:id|debtors|plans>?… → the backend's admin Ajo routes (read-only). */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const safe = path.filter((p) => /^[A-Za-z0-9-]+$/.test(p)).join("/");
  const search = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/ajo/${safe}${search}`, { headers: await adminHeaders(), cache: "no-store" });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
