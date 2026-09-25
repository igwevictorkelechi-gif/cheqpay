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
    // The detail goes to the server log only: a public probe must not hand out
    // database hostnames or usernames in its error text.
    console.error("[ready] database check failed", e);
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
