import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

export const dynamic = "force-dynamic";

/** Server-side proxy to the login/device activity endpoint. */
export async function GET(req: Request) {
  const search = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/security/activity${search}`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
