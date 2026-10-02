import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// How a broadcast did: accepted by Apple/Google, shown on devices, tapped.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await fetch(`${API_URL}/api/admin/broadcast/${encodeURIComponent(id)}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
