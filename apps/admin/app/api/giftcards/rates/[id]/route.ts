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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/api/admin/giftcards/rates/${encodeURIComponent(id)}`, "DELETE");
}
