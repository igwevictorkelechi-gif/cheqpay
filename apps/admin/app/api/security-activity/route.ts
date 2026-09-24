import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";


export const dynamic = "force-dynamic";

/** Server-side proxy to the login/device activity endpoint. */
export async function GET(req: Request) {
  const search = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/admin/security/activity${search}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
