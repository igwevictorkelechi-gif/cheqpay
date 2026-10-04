import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

async function forward(req: Request, path: string, method: string) {
  const hasBody = method !== "GET" && method !== "DELETE";
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: await adminHeaders(hasBody ? { "content-type": "application/json" } : {}),
    ...(hasBody ? { body: await req.text() } : {}),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/api/admin/giftcards/trades/${encodeURIComponent(id)}`, "GET");
}
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/api/admin/giftcards/trades/${encodeURIComponent(id)}`, "POST");
}
