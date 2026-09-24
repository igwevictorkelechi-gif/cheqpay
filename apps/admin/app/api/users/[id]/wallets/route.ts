import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy to the backend crypto-wallet admin endpoint. The admin
// secret stays on the server, same as the other proxies in this directory.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function headers() {
  return adminHeaders({ "content-type": "application/json" });
}

/** The user's crypto addresses plus everything still mintable. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/users/${id}/wallets`, {
    headers: await headers(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

/** Mint a unique deposit address for the user. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/users/${id}/wallets`, {
    method: "POST",
    headers: await headers(),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
