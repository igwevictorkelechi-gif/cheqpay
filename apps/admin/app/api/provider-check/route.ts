import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin provider-check endpoint.

export const dynamic = "force-dynamic";

export async function GET() {
  // The probes are live calls to Maplerad, so this is slower than the other
  // admin routes — an un-whitelisted IP in particular can sit until Maplerad's
  // own timeout. Given deliberately long headroom so a slow answer still
  // arrives rather than turning into a misleading "unreachable".
  const res = await fetch(`${API_URL}/api/admin/provider-check`, {
    headers: await adminHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
