import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The website is served from two hosts — Apache (mycheqpay.com, headers from
 * public/.htaccess) and Vercel (headers from /vercel.json). A header that
 * exists on only one of them is a hole on the other, so they must match.
 */
const ROOT = join(__dirname, "../../../..");

function htaccessHeaders(): Record<string, string> {
  const src = readFileSync(join(ROOT, "apps/web/public/.htaccess"), "utf8");
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

function vercelHeaders(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[];
  };
  const all = cfg.headers?.find((h) => h.source === "/(.*)");
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
}

describe("website security headers", () => {
  it("are the same on Apache and on Vercel", () => {
    expect(vercelHeaders()).toEqual(htaccessHeaders());
  });

  it("include the essentials", () => {
    const h = htaccessHeaders();
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    const csp = h["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // The site talks to the API and Supabase — and nothing else is allowed.
    expect(csp).toContain("https://cheqpay-admin453.vercel.app");
    expect(csp).toContain("https://xttgnswgeffyybjfjlkp.supabase.co");
    expect(csp).not.toMatch(/connect-src[^;]*\s\*(\s|;)/);
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
