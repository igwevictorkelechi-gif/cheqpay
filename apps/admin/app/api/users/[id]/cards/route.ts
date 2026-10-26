import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend admin cards endpoint. The admin secret and
// the signed-in admin's identity are added on the server, as in every proxy here.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The user's cards, USD balance and what a new card would cost. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/cards`, {
    headers: await adminHeaders({ "content-type": "application/json" }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

/** Create a card for the user, paid from their USD balance. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/cards`, {
    method: "POST",
    headers: await adminHeaders({ "content-type": "application/json" }),
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
