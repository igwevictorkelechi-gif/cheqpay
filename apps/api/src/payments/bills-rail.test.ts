import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getBillsProvider is the guard that keeps BILLS_PROVIDER=maplerad from
 * breaking the services Maplerad has no billers for (airtime/betting/food).
 * Both the env and the provider instances are module-cached, so each case
 * re-imports the module with a fresh process.env.
 */
async function billsProviderFor(service: string | undefined, env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { getBillsProvider } = await import("./index");
  return getBillsProvider(service).name;
}

const MAPLERAD_ON = {
  BILLS_PROVIDER: "maplerad",
  MAPLERAD_SECRET_KEY: "sk-test",
  FLUTTERWAVE_SECRET_KEY: "flw-test",
  FLUTTERWAVE_WEBHOOK_HASH: "flw-hash",
};

const ORIGINAL = { ...process.env };
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getBillsProvider — Maplerad per-service split", () => {
  it.each(["data", "electricity", "cabletv"])(
    "routes %s to Maplerad when BILLS_PROVIDER=maplerad",
    async (service) => {
      expect(await billsProviderFor(service, MAPLERAD_ON)).toBe("maplerad");
    }
  );

  it.each(["airtime", "betting", "food"])(
    "keeps %s on Flutterwave even when BILLS_PROVIDER=maplerad",
    async (service) => {
      expect(await billsProviderFor(service, MAPLERAD_ON)).toBe("flutterwave");
    }
  );

  it("falls back to Flutterwave when the Maplerad key is missing", async () => {
    const noKey = { ...MAPLERAD_ON, MAPLERAD_SECRET_KEY: "" };
    expect(await billsProviderFor("data", noKey)).toBe("flutterwave");
  });

  it("never selects Maplerad without a service (callers must pass one)", async () => {
    expect(await billsProviderFor(undefined, MAPLERAD_ON)).toBe("flutterwave");
  });

  it("leaves the default (auto) rail on Flutterwave", async () => {
    const auto = { ...MAPLERAD_ON, BILLS_PROVIDER: "auto" };
    expect(await billsProviderFor("data", auto)).toBe("flutterwave");
  });
});
