import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {}, UserStatus: {} }));

import { KYC_TIER_LIMITS } from "./kyc";
import { RETENTION_YEARS } from "./retention";
import { RECORD_RETENTION_YEARS, TIER_LIMITS } from "../../../web/src/lib/legal";
import { PUBLIC_ROUTES } from "../../../web/src/lib/site";

/**
 * The public legal documents state facts the API enforces. When the two drift,
 * the Terms promise a limit the app doesn't apply (or refuse a transaction the
 * Terms allow), and the Privacy Policy states a retention period the deletion
 * code doesn't follow. Both end up in a complaint or a regulator's letter, so
 * they are checked here rather than trusted to be edited together.
 */

const kobo = (naira: number) => BigInt(naira) * 100n;

describe("published limits match the enforced limits", () => {
  it.each(TIER_LIMITS.map((t) => [t.tier, t] as const))("tier %i", (tier, published) => {
    const enforced = KYC_TIER_LIMITS[tier];
    expect(enforced, `tier ${tier} missing from KYC_TIER_LIMITS`).toBeDefined();
    expect(enforced.singleTxKobo).toBe(kobo(published.singleTx));
    expect(enforced.dailyDepositKobo).toBe(kobo(published.dailyDeposit));
    expect(enforced.dailyWithdrawalKobo).toBe(kobo(published.dailyWithdrawal));
  });

  it("publishes every tier that can transact", () => {
    const transacting = Object.entries(KYC_TIER_LIMITS)
      .filter(([, l]) => l.singleTxKobo > 0n)
      .map(([t]) => Number(t))
      .sort();
    expect(TIER_LIMITS.map((t) => t.tier).sort()).toEqual(transacting);
  });
});

describe("published retention matches the deletion code", () => {
  it("states the same number of years retention.ts keeps records for", () => {
    expect(RECORD_RETENTION_YEARS).toBe(RETENTION_YEARS);
  });
});

const WEB_APP = join(__dirname, "..", "..", "..", "web", "src", "app");
const LEGAL_PAGES = ["terms", "privacy", "legal/aml", "legal/cookies", "legal/acceptable-use"];

describe("legal pages", () => {
  it.each(LEGAL_PAGES)("%s exists and is listed for search engines", (route) => {
    expect(existsSync(join(WEB_APP, route, "page.tsx"))).toBe(true);
    expect(PUBLIC_ROUTES as readonly string[]).toContain(`/${route}`);
  });

  it.each(LEGAL_PAGES)("%s ships no template disclaimer or placeholder", (route) => {
    const src = readFileSync(join(WEB_APP, route, "page.tsx"), "utf8");
    // A public policy that calls itself a template undermines itself, and one
    // with a bracketed placeholder tells every reader it was never finished.
    expect(src).not.toMatch(/general template/i);
    expect(src).not.toMatch(/\[(COMPANY|NAME|ADDRESS|RC|TBD|TODO)[^\]]*\]/i);
    // Claims that were false of this product in the old templates.
    expect(src).not.toMatch(/selfie|liveness/i);
  });
});
