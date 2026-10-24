import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

/** Forward a request to the backend's home-banner endpoints, keeping the admin secret on the server. */
export async function forwardBanner(req: Request, path: string, method: string) {
  const hasBody = method === "POST" || method === "PUT";
  const res = await fetch(`${API_URL}/api/admin/home-banner${path}`, {
    method,
    headers: await adminHeaders(hasBody ? { "content-type": "application/json" } : {}),
    ...(hasBody ? { body: await req.text() } : {}),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}
