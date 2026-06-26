import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness/health endpoint. Intentionally dependency-free so it reports the
 * service is up even before the database and integrations are provisioned.
 * A deeper readiness check (DB ping, provider reachability) lands in later
 * phases behind /api/ready.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "cheqpay-api",
    version: process.env.npm_package_version ?? "0.0.0",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}
