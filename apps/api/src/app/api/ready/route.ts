import { prisma } from "@cheqpay/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Readiness probe: confirms the API can reach the database (i.e. DATABASE_URL
 * is configured correctly). Unauthenticated and dependency-light — returns a
 * boolean DB status only, no sensitive detail. Browser-checkable.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "up",
      time: new Date().toISOString(),
    });
  } catch (e) {
    // Temporary diagnostic detail (Prisma error code + short message) so DB
    // connection problems are visible in the browser. Tighten/remove later.
    const err = e as { code?: string; message?: string; name?: string };
    const detail = `${err.code ?? err.name ?? "error"}: ${(err.message ?? String(e)).slice(0, 200)}`;
    return NextResponse.json(
      { status: "degraded", db: "down", detail },
      { status: 503 }
    );
  }
}
