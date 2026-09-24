import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

/**
 * Server-side proxy to the compliance subject lookup.
 *
 * adminHeaders() forwards the signed-in admin's email as `x-admin-actor` so the
 * backend can record WHO ran the search. A compliance lookup that cannot be attributed to a
 * person is not much use to an auditor — "someone at CheqPay read this
 * customer's record" is the wrong answer to give.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const reveal = url.searchParams.get("reveal") === "true";

  const qs = new URLSearchParams({ q, ...(reveal ? { reveal: "true" } : {}) });
  const res = await fetch(`${API_URL}/api/admin/subjects/lookup?${qs}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
