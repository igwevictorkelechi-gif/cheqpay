import { NextResponse } from "next/server";

/**
 * CORS for the API so browser apps (the web frontend) can call it from another
 * origin. Auth is by bearer token (no cookies), so echoing the request origin
 * is safe. Lock down to specific origins later via ALLOWED_ORIGINS if desired.
 */
function corsHeaders(origin: string): Record<string, string> {
  const allow = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowOrigin = allow.length === 0 || allow.includes(origin) ? origin : allow[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, idempotency-key, x-admin-secret, x-admin-actor",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function middleware(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = { matcher: "/api/:path*" };
