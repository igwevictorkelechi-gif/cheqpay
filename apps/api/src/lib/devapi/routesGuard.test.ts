import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SCOPE_IDS } from "@cheqpay/devapi";
import { openapiDocument } from "@cheqpay/devapi/openapi";

/**
 * Every public /v1 route goes through the gate, declares a real scope, and is
 * described in the API reference — and the reference describes nothing that
 * doesn't exist.
 *
 * A static check for the same reason as moneyRoutesPinned.test.ts: the failure
 * it guards against is omission. A new route written without withApi would
 * skip authentication, scopes, rate limits and logging all at once, and every
 * behavioural test of the routes that exist today would still pass.
 */

const V1 = join(__dirname, "..", "..", "app", "v1");
const NOT_API = new Set(["[...rest]/route.ts", "openapi.json/route.ts"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** "wallets/[id]/transactions/route.ts" → "/wallets/{id}/transactions" */
function specPath(rel: string): string {
  return "/" + rel.replace(/\/?route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const routes = routeFiles(V1)
  .map((full) => ({ rel: relative(V1, full).replace(/\\/g, "/"), src: strip(readFileSync(full, "utf8")) }))
  .filter((r) => !NOT_API.has(r.rel));

const paths = openapiDocument.paths as Record<string, Record<string, Record<string, unknown>>>;

describe("every /v1 route is gated and documented", () => {
  it("found the routes", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  for (const { rel, src } of routes) {
    const exported = METHODS.filter((m) => new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(src));

    it(`${rel} exports only withApi handlers`, () => {
      expect(exported.length).toBeGreaterThan(0);
      for (const m of exported) {
        expect(src).toMatch(new RegExp(`export\\s+const\\s+${m}\\s*=\\s*withApi\\(`));
      }
    });

    for (const m of exported) {
      it(`${m} ${specPath(rel)} declares a known scope that matches the reference`, () => {
        const call = src.slice(src.search(new RegExp(`export\\s+const\\s+${m}\\s*=\\s*withApi\\(`)));
        const scope = /scope:\s*"([^"]+)"/.exec(call)?.[1];
        expect(scope, "withApi needs { scope }").toBeDefined();
        expect(SCOPE_IDS).toContain(scope);
        const op = paths[specPath(rel)]?.[m.toLowerCase()];
        expect(op, `${m} ${specPath(rel)} is missing from the OpenAPI document`).toBeDefined();
        expect(op["x-cheqpay-scope"]).toBe(scope);
        if (op["x-cheqpay-money"]) {
          expect(call).toMatch(/moneyMoving:\s*true/);
          expect(call).toMatch(/ctx\.ip|initiatorIp/);
        }
      });
    }
  }

  it("the reference describes no route that doesn't exist", () => {
    const real = new Set(routes.flatMap(({ rel, src }) =>
      METHODS.filter((m) => new RegExp(`export\\s+const\\s+${m}\\s*=\\s*withApi\\(`).test(src)).map((m) => `${m.toLowerCase()} ${specPath(rel)}`),
    ));
    for (const [path, ops] of Object.entries(paths)) {
      for (const method of Object.keys(ops)) {
        expect(real.has(`${method} ${path}`), `${method.toUpperCase()} ${path} is documented but has no route`).toBe(true);
      }
    }
  });
});
