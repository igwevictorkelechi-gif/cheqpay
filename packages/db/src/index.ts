import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot reloads / serverless invocations.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * The runtime URL with a small, explicit connection pool.
 *
 * Without `connection_limit`, Prisma sizes each instance's pool from the CPU
 * count it sees — which on serverless hosts can be large — and keeps those
 * connections open while the instance lives. A deploy brings up new instances
 * while the old ones still hold theirs, and the database pooler's client cap
 * (200) ran out with only a handful of users: every query then failed with
 * EMAXCONN and pages like bills, balances and transactions showed "internal
 * server error". Each instance now holds at most DB_POOL_MAX (default 5); an
 * explicit, lower limit in DATABASE_URL is kept.
 */
export function pooledDatabaseUrl(raw = process.env.DATABASE_URL, maxRaw = process.env.DB_POOL_MAX): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const max = Math.max(1, Math.floor(Number(maxRaw) || 5));
    const current = Number(url.searchParams.get("connection_limit"));
    if (!current || current > max) url.searchParams.set("connection_limit", String(max));
    // Wait a little longer for a free connection rather than failing at once.
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
    return url.toString();
  } catch {
    return raw;
  }
}

const url = pooledDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Kept on globalThis in every environment, so a module evaluated twice in one
// process (separate server bundles) still shares one pool.
globalForPrisma.prisma = prisma;

// Re-export generated types + enums (Asset, Network, TransactionType, ...).
export * from "@prisma/client";
