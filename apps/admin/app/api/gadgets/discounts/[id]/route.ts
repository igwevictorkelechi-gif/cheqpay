import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/gadgets/discounts/${params.id}`, {
    method: "PATCH",
    headers: { "x-admin-secret": ADMIN_SECRET, "content-type": "application/json" },
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/gadgets/discounts/${params.id}`, {
    method: "DELETE",
    headers: { "x-admin-secret": ADMIN_SECRET },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
