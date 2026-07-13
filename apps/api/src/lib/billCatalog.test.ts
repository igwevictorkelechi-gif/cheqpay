import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentProvider, ProviderBillPlan } from "@/payments/types";

/**
 * The catalog's contract: users only ever see plans the provider will actually
 * honour. The failure path matters most — a provider outage must never surface
 * invented prices, because a plan we can't buy still debits the customer first.
 */

const listBillPlans = vi.fn();

vi.mock("@/payments", () => ({
  getBillsProvider: (): PaymentProvider =>
    ({ name: "maplerad", listBillPlans } as unknown as PaymentProvider),
}));

const plan = (code: string, name: string, amountMinor: number): ProviderBillPlan => ({
  code,
  name,
  amountMinor,
});

async function load() {
  vi.resetModules();
  return import("./billCatalog");
}

beforeEach(() => {
  listBillPlans.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getBillCatalog", () => {
  it("serves the provider's live plans, priced from its kobo amounts", async () => {
    listBillPlans.mockImplementation(async (service: string, biller: string) =>
      service === "data" && biller === "mtn-data-ng"
        ? [plan("BUNDLE-1GB", "1GB · 30 days", 55_000)]
        : []
    );

    const { getBillCatalog } = await load();
    const data = (await getBillCatalog()).find((s) => s.service === "data")!;
    const mtn = data.plans.filter((p) => p.billerId === "mtn");

    expect(mtn).toEqual([
      {
        id: "mtn:BUNDLE-1GB",
        billerId: "mtn",
        name: "1GB · 30 days",
        amount: "550", // 55 000 kobo, exact — the price Maplerad quoted
        providerCode: "BUNDLE-1GB",
      },
    ]);
  });

  it("renders kobo remainders exactly, without float drift", async () => {
    listBillPlans.mockImplementation(async (s: string, b: string) =>
      s === "data" && b === "mtn-data-ng" ? [plan("X", "Odd", 250_050)] : []
    );
    const { getBillCatalog } = await load();
    const data = (await getBillCatalog()).find((s) => s.service === "data")!;
    expect(data.plans.find((p) => p.billerId === "mtn")?.amount).toBe("2500.50");
  });

  it("offers NO plans for a biller it cannot reach, rather than invented ones", async () => {
    listBillPlans.mockRejectedValue(new Error("maplerad down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getBillCatalog } = await load();
    const catalog = await getBillCatalog();
    const data = catalog.find((s) => s.service === "data")!;
    const cable = catalog.find((s) => s.service === "cabletv")!;

    // Empty means "cannot buy" — safe. Stale mock prices would mean charging a
    // customer for a bundle that will not be delivered.
    expect(data.plans).toEqual([]);
    expect(cable.plans).toEqual([]);
    // Billers are ours, so they survive the outage and still render.
    expect(data.billers.length).toBeGreaterThan(0);
  });

  it("keeps the last good plans when a refresh fails after the cache expires", async () => {
    listBillPlans.mockImplementation(async (s: string, b: string) =>
      s === "data" && b === "mtn-data-ng" ? [plan("B1", "1GB", 60_000)] : []
    );
    const { getBillCatalog } = await load();
    await getBillCatalog(); // warm the cache with good plans

    // Let the cache go stale, then have the provider fall over.
    const later = Date.now() + 60 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    listBillPlans.mockRejectedValue(new Error("maplerad down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const data = (await getBillCatalog()).find((s) => s.service === "data")!;
    // Stale but real — a price Maplerad did quote — beats no service at all.
    expect(data.plans.filter((p) => p.billerId === "mtn")).toEqual([
      { id: "mtn:B1", billerId: "mtn", name: "1GB", amount: "600", providerCode: "B1" },
    ]);
  });

  it("leaves variable-amount services alone (airtime has no plans to fetch)", async () => {
    listBillPlans.mockResolvedValue([]);
    const { getBillCatalog } = await load();
    const airtime = (await getBillCatalog()).find((s) => s.service === "airtime")!;

    expect(airtime.variableAmount).toBe(true);
    expect(airtime.plans).toEqual([]);
    // Airtime is never fetched — only data and cable are live.
    for (const call of listBillPlans.mock.calls) {
      expect(["data", "cabletv"]).toContain(call[0]);
    }
  });

  it("caches, so a burst of catalog reads is not a burst of provider calls", async () => {
    listBillPlans.mockResolvedValue([]);
    const { getBillCatalog } = await load();

    await Promise.all([getBillCatalog(), getBillCatalog(), getBillCatalog()]);
    const billersFetched = listBillPlans.mock.calls.length;

    await getBillCatalog();
    expect(listBillPlans.mock.calls.length).toBe(billersFetched); // served from cache
  });
});

describe("getLivePlan", () => {
  it("finds the plan the user selected, carrying the provider's code", async () => {
    listBillPlans.mockImplementation(async (s: string, b: string) =>
      s === "data" && b === "glo-data-ng" ? [plan("G5", "5GB", 250_000)] : []
    );
    const { getLivePlan } = await load();

    const p = await getLivePlan("data", "glo:G5");
    expect(p).toMatchObject({ providerCode: "G5", amount: "2500", billerId: "glo" });
    await expect(getLivePlan("data", "glo:NOPE")).resolves.toBeUndefined();
  });
});
