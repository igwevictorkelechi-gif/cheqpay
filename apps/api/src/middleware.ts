import { NextResponse } from "next/server";

/**
 * CORS for the API: the browser apps allowed to call it from another origin.
 *
 * Only the sites below (plus any in ALLOWED_ORIGINS) are answered with an
 * Allow-Origin header; any other site gets none, so a browser refuses to let it
 * read the response. Auth is by bearer token rather than cookies, so this is
 * defence in depth — but it means a page on some other site can't drive the
 * API with a token it has got hold of. The mobile app and the admin
 * dashboard's server don't send an Origin, so CORS never applies to them.
 */
const DEFAULT_ORIGINS = [
  "https://mycheqpay.com",
  "https://www.mycheqpay.com",
  "https://cheqpay.vercel.app",
];

export function allowedOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const dev = env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://localhost:3001"];
  return new Set([...DEFAULT_ORIGINS, ...extra, ...dev]);
}

export function corsHeaders(
  origin: string | null,
  allow: Set<string> = allowedOrigins()
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    // Only what the browser apps actually send. The admin headers are
    // server-to-server and are deliberately not listed.
    "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key, x-transaction-pin",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allow.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function middleware(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  // The API only ever returns JSON; never let a browser sniff it into HTML.
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export const config = { matcher: "/api/:path*" };
