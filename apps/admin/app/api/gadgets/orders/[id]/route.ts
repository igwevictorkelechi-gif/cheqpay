import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/gadgets/orders/${params.id}`, {
    method: "PATCH",
    headers: await adminHeaders({ "content-type": "application/json" }),
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
