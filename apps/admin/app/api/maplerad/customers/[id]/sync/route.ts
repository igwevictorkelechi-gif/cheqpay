import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

// Server-side proxy to the backend Maplerad customer sync. The admin secret
// stays on the server and is never exposed to the browser, exactly like the
// user-detail proxy next door.
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/maplerad/customers/${id}/sync`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET, "x-admin-actor": "admin-dashboard" },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
