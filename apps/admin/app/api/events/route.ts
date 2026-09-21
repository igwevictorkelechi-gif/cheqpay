import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/events`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const res = await fetch(`${API_URL}/api/admin/events`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET, "content-type": "application/json" },
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
