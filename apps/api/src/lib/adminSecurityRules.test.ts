import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({
  Network: {
    BITCOIN: "BITCOIN",
    TRON: "TRON",
    BSC: "BSC",
    ETHEREUM: "ETHEREUM",
    SOLANA: "SOLANA",
    BASE: "BASE",
    POLYGON: "POLYGON",
  },
  prisma: {},
}));

import { isPlausibleTxHash } from "./txHashFormat";
import { parseLimits } from "./adminCreditCap";

/**
 * The admin-security rules written after the 22 Sep 2026 incident.
 *
 * The static checks at the bottom follow schemaBootstrap.test.ts and
 * moneyRoutesPinned.test.ts: the failure they prevent is silent — a new route
 * that forgets a guard works perfectly until the day it is abused — so the
 * guard is asserted in the source rather than hoped for.
 */

describe("isPlausibleTxHash", () => {
  it("rejects the made-up hash used on 22 Sep", () => {
    expect(isPlausibleTxHash("TRON", "ptprobed0f5ac83")).toBe(false);
    expect(isPlausibleTxHash("BSC", "ptprobed0f5ac83")).toBe(false);
    expect(isPlausibleTxHash(null, "ptprobed0f5ac83")).toBe(false);
  });

  it("accepts real shapes per chain", () => {
    const hex = "5c9a520ff04d46fdee65133943c3f6885dadb1caacdb26367514b8af5ec7f935";
    expect(isPlausibleTxHash("BSC", `0x${hex}`)).toBe(true);
    expect(isPlausibleTxHash("ETHEREUM", `0x${hex}`)).toBe(true);
    expect(isPlausibleTxHash("TRON", hex)).toBe(true);
    expect(isPlausibleTxHash("BITCOIN", hex)).toBe(true);
    expect(
      isPlausibleTxHash(
        "SOLANA",
        "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
      ),
    ).toBe(true);
  });

  it("does not take an EVM-shaped hash on a chain that doesn't use one", () => {
    expect(isPlausibleTxHash("BSC", "5c9a520ff04d46fdee65133943c3f6885dadb1caacdb26367514b8af5ec7f935")).toBe(false);
  });
});

describe("parseLimits", () => {
  it("has low defaults that would have stopped 10,000 USDT and 1 BTC", () => {
    const l = parseLimits(undefined);
    expect(Number(l.USDT)).toBeLessThan(10_000);
    expect(Number(l.BTC)).toBeLessThan(1);
  });

  it("reads overrides from the environment and ignores junk", () => {
    const l = parseLimits("NGN=5000000, usdt=2500, BTC=abc, FAKE=9");
    expect(l.NGN).toBe("5000000");
    expect(l.USDT).toBe("2500");
    expect(l.BTC).toBe(parseLimits(undefined).BTC);
    expect("FAKE" in l).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static guards.
// ---------------------------------------------------------------------------

const API_ADMIN = join(__dirname, "..", "app", "api", "admin");
const ADMIN_APP_API = join(__dirname, "..", "..", "..", "admin", "app", "api");

function read(rel: string): string {
  return readFileSync(join(API_ADMIN, rel), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name === "route.ts" ? [p] : [];
  });
}

/** Actions that move money, grant trust, or change who can do either. */
const STEP_UP_ROUTES: Array<{ file: string; superOnly?: boolean; why: string }> = [
  { file: "adjust-balance/route.ts", superOnly: true, why: "creates money from nothing" },
  { file: "credit-crypto/route.ts", why: "asserts a deposit arrived" },
  { file: "withdrawals/route.ts", why: "releases money for good" },
  { file: "crypto-wallets/route.ts", superOnly: true, why: "sets where every customer deposits" },
  { file: "settings/route.ts", superOnly: true, why: "sets rates, margins and fees" },
  { file: "roles/route.ts", superOnly: true, why: "decides who is an admin" },
  { file: "otp/route.ts", superOnly: true, why: "is the second factor itself" },
  { file: "users/[id]/route.ts", why: "unblocks accounts and raises KYC tiers" },
  { file: "kyc/route.ts", why: "approves identity and raises tiers" },
  { file: "blocked-ips/route.ts", superOnly: true, why: "lets blocked addresses back in" },
  { file: "credentials/route.ts", why: "changes the admin login" },
];

describe("sensitive admin routes", () => {
  it.each(STEP_UP_ROUTES)("$file names the admin and asks for a fresh code ($why)", ({ file, superOnly }) => {
    const src = read(file);
    expect(src).toContain("requireAdminActor(req");
    expect(src).toContain("requireAdminOtp(req");
    if (superOnly) expect(src).toMatch(/superOnly: true|role !== "super"/);
  });

  it("never falls back to an anonymous actor", () => {
    for (const { file } of STEP_UP_ROUTES) {
      expect(read(file), file).not.toMatch(/x-admin-actor"\) \?\? "admin"/);
    }
  });
});

describe("admin dashboard proxies", () => {
  it("all reach the backend through adminHeaders(), so every call carries who is acting", () => {
    const offenders = walk(ADMIN_APP_API)
      .filter((p) => !p.endsWith(join("api", "auth", "route.ts")))
      .filter((p) => readFileSync(p, "utf8").includes("x-admin-secret"))
      .map((p) => relative(ADMIN_APP_API, p));
    expect(offenders).toEqual([]);
  });
});

describe("admin credentials", () => {
  it("has no working built-in password", () => {
    const src = readFileSync(join(__dirname, "adminCreds.ts"), "utf8");
    expect(src).not.toMatch(/\|\|\s*"CheqPayAdmin!2026"/);
    expect(src).toContain("PUBLISHED_PASSWORDS");
  });
});
