import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prisma binds a JavaScript number as bigint, and Postgres has no
 * make_interval(mins => bigint): the query fails with 42883. That took the
 * auto cash-out and social publisher jobs down in production, so every
 * interpolated make_interval argument must carry an explicit ::int cast.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("make_interval arguments", () => {
  it("are cast to int wherever a value is interpolated", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, ".."))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/make_interval\(\s*\w+\s*=>\s*(\$\{[^}]+\}|\$\d+)(::\w+)?\s*\)/g)) {
        if (m[2] !== "::int") bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
