import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

/** Proxy a request to the backend API as the signed-in admin (with any authenticator code). */
export async function forward(req: Request, path: string, method: string): Promise<NextResponse> {
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
