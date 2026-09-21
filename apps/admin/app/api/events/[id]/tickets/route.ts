import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/events/${params.id}/tickets`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
