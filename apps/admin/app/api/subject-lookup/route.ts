import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { SESSION_COOKIE, sessionEmail } from "@/lib/adminAuth";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

/**
 * Server-side proxy to the compliance subject lookup.
 *
 * Forwards the signed-in admin's email as `x-admin-actor` so the backend can
 * record WHO ran the search. A compliance lookup that cannot be attributed to a
 * person is not much use to an auditor — "someone at CheqPay read this
 * customer's record" is the wrong answer to give.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const reveal = url.searchParams.get("reveal") === "true";

  // Attribute the search to the signed-in admin, read from the session cookie.
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const actor = (await sessionEmail(raw)) ?? "unknown-admin";

  const qs = new URLSearchParams({ q, ...(reveal ? { reveal: "true" } : {}) });
  const res = await fetch(`${API_URL}/api/admin/subjects/lookup?${qs}`, {
    headers: { "x-admin-secret": ADMIN_SECRET, "x-admin-actor": actor },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
