import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/events/${params.id}`, {
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/events/${params.id}`, {
    method: "PATCH",
    headers: await adminHeaders({ "content-type": "application/json" }),
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/admin/events/${params.id}`, {
    method: "DELETE",
    headers: await adminHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
