import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mock providers must be unreachable by accident.
 *
 * Two separate holes, both of which fail by looking like success rather than by
 * erroring — which is what makes them worth guarding:
 *
 *   1. A typo in PAYMENT_PROVIDER silently selected the mock rail, which
 *      answers a deposit with an invented "Mock Test Bank" account number.
 *   2. An explicit `mock` on the production deployment does the same thing
 *      deliberately.
 *
 * Neither logs an error. The deposit screen looks correct. Money sent to that
 * account number is gone.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL };
  delete process.env.VERCEL_ENV;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

/** Import the module graph fresh so env parsing re-runs against process.env. */
async function load() {
  const env = await import("./env");
  env.getEnv(); // parse now, so invalid values are recorded
  return env;
}

describe("assertProviderConfigured — typos must not select a mock rail", () => {
  it("refuses a payment rail whose value is not recognised", async () => {
    process.env.PAYMENT_PROVIDER = "maplerad ";  // trailing space is fine
    process.env.KYC_PROVIDER = "maplerad-live";  // not a real value
    const { assertProviderConfigured } = await load();

    // The typo'd one throws...
    expect(() => assertProviderConfigured("KYC_PROVIDER")).toThrow(/not recognised/);
    // ...and names the variable, so the fix is obvious from the message alone.
    expect(() => assertProviderConfigured("KYC_PROVIDER")).toThrow(/KYC_PROVIDER/);
    // ...while the merely untidy one is accepted (trimmed + lowercased).
    expect(() => assertProviderConfigured("PAYMENT_PROVIDER")).not.toThrow();
  });

  it("says nothing when every provider var is valid", async () => {
    process.env.PAYMENT_PROVIDER = "mock";
    process.env.CUSTODY_PROVIDER = "mock";
    process.env.KYC_PROVIDER = "mock";
    const { assertProviderConfigured } = await load();

    for (const name of ["PAYMENT_PROVIDER", "CUSTODY_PROVIDER", "KYC_PROVIDER"]) {
      expect(() => assertProviderConfigured(name)).not.toThrow();
    }
  });
});

describe("assertNotMockInProduction", () => {
  it("refuses mock on the production deployment", async () => {
    process.env.VERCEL_ENV = "production";
    const { assertNotMockInProduction } = await load();
    expect(() => assertNotMockInProduction("PAYMENT_PROVIDER", "mock")).toThrow(
      /must never\s+serve real users|production deployment/
    );
  });

  it("allows mock on a preview deployment", async () => {
    // Vercel sets NODE_ENV=production for preview builds too, so NODE_ENV alone
    // cannot tell the two apart — VERCEL_ENV is the only signal that can.
    process.env.VERCEL_ENV = "preview";
    // @types/node marks NODE_ENV readonly; this is a test fixture, not app code.
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { assertNotMockInProduction } = await load();
    expect(() => assertNotMockInProduction("PAYMENT_PROVIDER", "mock")).not.toThrow();
  });

  it("allows mock locally and in tests", async () => {
    const { assertNotMockInProduction } = await load();
    expect(() => assertNotMockInProduction("PAYMENT_PROVIDER", "mock")).not.toThrow();
  });

  it("never objects to a real provider", async () => {
    process.env.VERCEL_ENV = "production";
    const { assertNotMockInProduction } = await load();
    expect(() => assertNotMockInProduction("PAYMENT_PROVIDER", "maplerad")).not.toThrow();
  });

  it("falls back to NODE_ENV where VERCEL_ENV is absent", async () => {
    // Render and similar hosts set no VERCEL_ENV; there, a production build is
    // the production deployment.
    // @types/node marks NODE_ENV readonly; this is a test fixture, not app code.
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { assertNotMockInProduction, isLiveDeployment } = await load();
    expect(isLiveDeployment()).toBe(true);
    expect(() => assertNotMockInProduction("CUSTODY_PROVIDER", "mock")).toThrow();
  });
});

describe("getPaymentProvider refuses rather than inventing an account number", () => {
  it("throws on the production deployment instead of returning the mock", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PAYMENT_PROVIDER = "mock";
    const { getPaymentProvider } = await import("../payments");
    expect(() => getPaymentProvider()).toThrow(/mock/i);
  });

  it("throws on a typo instead of falling back to the mock", async () => {
    process.env.PAYMENT_PROVIDER = "maplrad"; // transposed
    const { getPaymentProvider } = await import("../payments");
    expect(() => getPaymentProvider()).toThrow(/not recognised/);
  });
});
