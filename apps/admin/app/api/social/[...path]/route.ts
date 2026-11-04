import { NextResponse } from "next/server";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

// Server-side proxy for the Social section: /api/social/<path> here →
// /api/admin/social/<path> on the backend, as the signed-in admin. It also
// states this dashboard's own origin (x-admin-origin) so a platform login can
// send the admin back here — set server-side, never taken from the browser.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

async function forward(req: Request, ctx: Ctx, method: string) {
  const { path } = await ctx.params;
  if (!path.every((s) => SAFE_SEGMENT.test(s))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const hasBody = method === "POST" || method === "PUT";
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const res = await fetch(`${API_URL}/api/admin/social/${path.join("/")}${url.search}`, {
    method,
    headers: await adminHeaders({
      ...(hasBody ? { "content-type": "application/json" } : {}),
      "x-admin-origin": `${proto}://${host}`,
    }),
    ...(hasBody ? { body: await req.text() } : {}),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  return NextResponse.json(data, { status: res.status });
}

export const GET = (req: Request, ctx: Ctx) => forward(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => forward(req, ctx, "POST");
export const PUT = (req: Request, ctx: Ctx) => forward(req, ctx, "PUT");
export const DELETE = (req: Request, ctx: Ctx) => forward(req, ctx, "DELETE");
