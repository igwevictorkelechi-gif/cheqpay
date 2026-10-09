import { describe, expect, it } from "vitest";
import { pooledDatabaseUrl } from "@cheqpay/db";

// Each server instance must hold only a few database connections: an uncapped
// pool exhausted the pooler's 200-client limit during deploys (EMAXCONN).
describe("database connection pool", () => {
  const base = "postgresql://u:p@db.example.com:6543/postgres?pgbouncer=true";
  const limit = (u?: string) => Number(new URL(u!).searchParams.get("connection_limit"));

  it("caps an unset pool at 5 and keeps the other parameters", () => {
    const u = pooledDatabaseUrl(base, undefined)!;
    expect(limit(u)).toBe(5);
    expect(new URL(u).searchParams.get("pgbouncer")).toBe("true");
    expect(new URL(u).searchParams.get("pool_timeout")).toBe("20");
  });

  it("lowers a larger limit, keeps a smaller one, and honours DB_POOL_MAX", () => {
    expect(limit(pooledDatabaseUrl(`${base}&connection_limit=40`, undefined))).toBe(5);
    expect(limit(pooledDatabaseUrl(`${base}&connection_limit=1`, undefined))).toBe(1);
    expect(limit(pooledDatabaseUrl(base, "8"))).toBe(8);
    expect(limit(pooledDatabaseUrl(base, "nonsense"))).toBe(5);
  });

  it("leaves a missing or unparsable URL alone", () => {
    expect(pooledDatabaseUrl(undefined, undefined)).toBeUndefined();
    expect(pooledDatabaseUrl("not a url", undefined)).toBe("not a url");
  });
});
