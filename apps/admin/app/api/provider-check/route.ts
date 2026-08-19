import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

// Server-side proxy to the backend admin provider-check endpoint.
const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  // The probes are live calls to Maplerad, so this is slower than the other
  // admin routes — an un-whitelisted IP in particular can sit until Maplerad's
  // own timeout. Given deliberately long headroom so a slow answer still
  // arrives rather than turning into a misleading "unreachable".
  const res = await fetch(`${API_URL}/api/admin/provider-check`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
