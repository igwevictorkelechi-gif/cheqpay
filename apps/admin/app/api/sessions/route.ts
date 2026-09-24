import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { SESSION_COOKIE } from "@/lib/adminAuth";
import { adminHeaders } from "@/lib/backend";

// "Sign out everywhere": revokes every admin session on the backend, then
// clears this browser's cookie too.
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await fetch(`${API_URL}/api/admin/sessions`, {
    method: "POST",
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  const out = NextResponse.json(data, { status: res.status });
  if (res.ok) out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return out;
}
