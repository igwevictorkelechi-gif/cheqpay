import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every helper that adds a COLUMN to an existing table must run at boot.
 *
 * Migrations are not applied on deploy in this project, so columns are created
 * by idempotent `ensure*` helpers. Prisma selects every column a model declares
 * on every query of that model, so the instant a column joins the schema, every
 * query of that model emits it — whether or not the feature that owns the
 * column is ever used.
 *
 * A helper that runs only on first use of its own feature therefore creates a
 * deadlock: the column is missing, so every query of the model fails, including
 * the ones on the path that would have created it. This has now happened twice
 * in production — once for legal_name/bvn_*, once for maplerad_tier and the
 * address columns, which took out the admin user list, KYC and virtual accounts
 * simultaneously.
 *
 * This test is a static check, not a runtime one: it reads the source and
 * asserts that every ensure* helper containing an ALTER TABLE is referenced by
 * instrumentation.ts. It cannot be satisfied by remembering — only by wiring.
 */

// The whole API source tree, not just lib/. Every ALTER lives in lib/ today,
// but a scan scoped to where the problem happened to be found last time would
// miss the next one silently — which is the failure mode this file exists to
// prevent.
const SRC_DIR = join(__dirname, "..");
const INSTRUMENTATION = join(__dirname, "..", "instrumentation.ts");

/** Every .ts file under src/, excluding tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * The source of a function, from its opening brace to the matching close.
 *
 * Needed because the check is about what a function's OWN body does. Testing
 * the whole file instead would flag every exported ensure* in a file that
 * happens to contain an ALTER somewhere — e.g. ensureMapleradCustomer, which is
 * the enrolment call, not a schema helper.
 */
function functionBody(src: string, startIndex: number): string {
  const open = src.indexOf("{", startIndex);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** ensure* helpers whose own body adds a column to an existing table. */
function columnAddingHelpers(): Array<{ file: string; fn: string }> {
  const found: Array<{ file: string; fn: string }> = [];

  for (const path of sourceFiles(SRC_DIR)) {
    const file = path.slice(SRC_DIR.length + 1);
    const src = readFileSync(path, "utf8");
    if (!/ALTER TABLE/i.test(src)) continue;

    for (const m of src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(ensure\w+)/g)) {
      const body = functionBody(src, m.index + m[0].length);
      // Only ADD COLUMN matters. A helper that creates a whole new table is safe
      // to run lazily: no existing model selects columns that do not exist yet.
      if (/ALTER TABLE/i.test(body) && /ADD COLUMN/i.test(body)) {
        found.push({ file, fn: m[1] });
      }
    }
  }

  return found;
}

describe("runtime schema bootstrap", () => {
  const helpers = columnAddingHelpers();

  it("finds the column-adding helpers at all", () => {
    // Guards the guard: if the scan silently matched nothing, every assertion
    // below would pass vacuously and the check would be worthless.
    expect(helpers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(helpers)("$fn ($file) runs at boot from instrumentation.ts", ({ fn }) => {
    // Comments and the import destructure both mention the name without calling
    // it, so a substring match passes even when the call has been deleted —
    // verified by deleting it. Strip comments, then require an actual call.
    const boot = readFileSync(INSTRUMENTATION, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(
      new RegExp(`\\b${fn}\\s*\\(`).test(boot),
      `${fn} adds a column to an existing table but is not called from ` +
        `instrumentation.ts. Until it runs at boot, every Prisma query of that ` +
        `model fails with "column does not exist" — including the requests on ` +
        `the code path that would have created it.`
    ).toBe(true);
  });

  it("exports every column-adding helper so boot can reach it", () => {
    // A private helper cannot be wired in, which is how the last one was missed.
    for (const { file, fn } of helpers) {
      const src = readFileSync(join(SRC_DIR, file), "utf8");
      expect(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`).test(src)).toBe(true);
    }
  });
});
