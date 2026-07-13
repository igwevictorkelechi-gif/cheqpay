import { getBillsProvider } from "@/payments";
import type { BillPlan, ServiceConfig } from "./bills";
import { BILL_CATALOG } from "./bills";

/**
 * The bill catalog, with data bundles and cable bouquets fetched live from the
 * payment provider.
 *
 * Why live: the rail buys a plan by the provider's own code, and the price the
 * user sees must be the price the provider charges. Hardcoding plans meant any
 * drift — a bundle repriced, retired, renamed — silently produced plans that
 * could not be bought. Now the list IS the provider's list.
 *
 * Failure is deliberately conservative. If the provider can't be reached we
 * serve the last good plans (stale but real), and if we have none we serve NO
 * plans for that biller rather than invented ones: an empty plan list means the
 * user simply can't buy, which is always better than charging them for a bundle
 * that won't be delivered. Billers, which we curate ourselves, are unaffected.
 */

const TTL_MS = 15 * 60_000;
/** Services whose plans come from the provider rather than the static catalog. */
const LIVE_SERVICES = new Set(["data", "cabletv"]);

let cache: { at: number; services: ServiceConfig[] } | null = null;
let inflight: Promise<ServiceConfig[]> | null = null;

/** The catalog as the apps should see it. Cached for TTL_MS. */
export async function getBillCatalog(): Promise<ServiceConfig[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.services;
  // Collapse concurrent refreshes into one round of provider calls.
  if (!inflight) {
    inflight = build().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Look up a plan the user selected, by its catalog id. */
export async function getLivePlan(
  service: string,
  planId: string
): Promise<BillPlan | undefined> {
  const services = await getBillCatalog();
  return services.find((s) => s.service === service)?.plans.find((p) => p.id === planId);
}

/** Drop the cache — used after an admin edit, or by tests. */
export function resetBillCatalogCache(): void {
  cache = null;
}

async function build(): Promise<ServiceConfig[]> {
  const psp = getBillsProvider();

  // A provider that publishes no plan list (the mock) keeps the static plans,
  // so local dev still renders something to click.
  if (!psp.listBillPlans) {
    const services = BILL_CATALOG;
    cache = { at: Date.now(), services };
    return services;
  }

  const previous = cache?.services;

  const services = await Promise.all(
    BILL_CATALOG.map(async (svc) => {
      if (!LIVE_SERVICES.has(svc.service)) return svc;

      const perBiller = await Promise.all(
        svc.billers.map(async (biller) => {
          if (!biller.mapleradId) return [];
          try {
            const plans = await psp.listBillPlans!(
              svc.service as "data" | "cabletv",
              biller.mapleradId
            );
            return plans.map<BillPlan>((p) => ({
              // Namespaced by biller so ids stay unique across the service.
              id: `${biller.id}:${p.code}`,
              billerId: biller.id,
              name: p.name,
              amount: minorToNaira(p.amountMinor),
              providerCode: p.code,
            }));
          } catch (err) {
            // Keep this biller's last known plans if we have them; otherwise it
            // offers nothing this cycle. Never fall back to invented prices.
            const stale = previous
              ?.find((s) => s.service === svc.service)
              ?.plans.filter((p) => p.billerId === biller.id);
            console.error("[billCatalog] plan fetch failed", {
              service: svc.service,
              biller: biller.id,
              keptStalePlans: stale?.length ?? 0,
              error: err instanceof Error ? err.message : String(err),
            });
            return stale ?? [];
          }
        })
      );

      return { ...svc, plans: perBiller.flat() };
    })
  );

  cache = { at: Date.now(), services };
  return services;
}

/** 250050 -> "2500.50", 10000 -> "100". Kobo is exact; no float rounding. */
function minorToNaira(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const kobo = Math.abs(minor % 100);
  return kobo === 0 ? String(whole) : `${whole}.${String(kobo).padStart(2, "0")}`;
}
