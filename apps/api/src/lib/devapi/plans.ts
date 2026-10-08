import { prisma } from "@cheqpay/db";
import { cachedSetting, invalidateSetting } from "../settingsCache";

/**
 * Developer plans. Prices, rate limits, fees and caps are admin-editable (one
 * JSON blob in platform_settings) and merged over these defaults, so a missing
 * or partly-written setting can never produce a plan with no rate limit or a
 * zero price by accident.
 *
 * Money units: priceMinor and NGN fee caps in kobo; card fees in US cents.
 * A cap of 0 means "no cap".
 */
export const PLAN_IDS = ["sandbox", "starter", "growth", "scale"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PAID_PLAN_IDS = ["starter", "growth", "scale"] as const satisfies readonly PlanId[];

export interface DevPlan {
  id: PlanId;
  name: string;
  /** Monthly price in kobo. */
  priceMinor: number;
  /** Whether the plan unlocks live keys. Only the sandbox plan is test-only. */
  live: boolean;
  /** Requests per minute, per key. */
  rpm: number;
  billFeeBps: number;
  billFeeCapMinor: number;
  depositFeeBps: number;
  depositFeeCapMinor: number;
  cardIssueFeeCents: number;
  cardFundFeeBps: number;
  maxCustomers: number;
  maxVirtualAccounts: number;
  maxActiveCards: number;
  webhookEndpoints: number;
}

export const PLAN_DEFAULTS: Record<PlanId, DevPlan> = {
  sandbox: {
    id: "sandbox",
    name: "Sandbox",
    priceMinor: 0,
    live: false,
    rpm: 60,
    billFeeBps: 100,
    billFeeCapMinor: 10_000,
    depositFeeBps: 100,
    depositFeeCapMinor: 30_000,
    cardIssueFeeCents: 300,
    cardFundFeeBps: 150,
    maxCustomers: 100,
    maxVirtualAccounts: 100,
    maxActiveCards: 25,
    webhookEndpoints: 2,
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceMinor: 1_500_000,
    live: true,
    rpm: 60,
    billFeeBps: 100,
    billFeeCapMinor: 10_000,
    depositFeeBps: 100,
    depositFeeCapMinor: 30_000,
    cardIssueFeeCents: 300,
    cardFundFeeBps: 150,
    maxCustomers: 1_000,
    maxVirtualAccounts: 1_000,
    maxActiveCards: 100,
    webhookEndpoints: 2,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMinor: 5_000_000,
    live: true,
    rpm: 300,
    billFeeBps: 50,
    billFeeCapMinor: 5_000,
    depositFeeBps: 75,
    depositFeeCapMinor: 25_000,
    cardIssueFeeCents: 250,
    cardFundFeeBps: 125,
    maxCustomers: 10_000,
    maxVirtualAccounts: 10_000,
    maxActiveCards: 1_000,
    webhookEndpoints: 5,
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceMinor: 15_000_000,
    live: true,
    rpm: 1_000,
    billFeeBps: 25,
    billFeeCapMinor: 2_500,
    depositFeeBps: 50,
    depositFeeCapMinor: 20_000,
    cardIssueFeeCents: 200,
    cardFundFeeBps: 100,
    maxCustomers: 100_000,
    maxVirtualAccounts: 100_000,
    maxActiveCards: 10_000,
    webhookEndpoints: 10,
  },
};

/** The numeric fields and the range each must stay inside. */
export const PLAN_FIELD_BOUNDS: Record<Exclude<keyof DevPlan, "id" | "name" | "live">, [number, number]> = {
  priceMinor: [0, 100_000_000_00],
  rpm: [1, 10_000],
  billFeeBps: [0, 2_000],
  billFeeCapMinor: [0, 10_000_000],
  depositFeeBps: [0, 2_000],
  depositFeeCapMinor: [0, 10_000_000],
  cardIssueFeeCents: [0, 100_00],
  cardFundFeeBps: [0, 2_000],
  maxCustomers: [0, 10_000_000],
  maxVirtualAccounts: [0, 10_000_000],
  maxActiveCards: [0, 1_000_000],
  webhookEndpoints: [0, 50],
};

const KEY = "developer_plans";

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

export function isPaidPlanId(v: unknown): v is (typeof PAID_PLAN_IDS)[number] {
  return typeof v === "string" && (PAID_PLAN_IDS as readonly string[]).includes(v);
}

/** Merge a stored (possibly partial or corrupt) blob over the defaults, field by field. */
export function mergePlans(stored: unknown): Record<PlanId, DevPlan> {
  const out = structuredClone(PLAN_DEFAULTS);
  if (!stored || typeof stored !== "object") return out;
  for (const id of PLAN_IDS) {
    const s = (stored as Record<string, unknown>)[id];
    if (!s || typeof s !== "object") continue;
    const plan = out[id];
    const name = (s as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim().length > 0 && name.length <= 40) plan.name = name.trim();
    for (const [field, [min, max]] of Object.entries(PLAN_FIELD_BOUNDS)) {
      const v = (s as Record<string, unknown>)[field];
      if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) {
        (plan as unknown as Record<string, number>)[field] = v;
      }
    }
    // The sandbox is always free and never live, whatever the blob says.
    if (id === "sandbox") {
      plan.priceMinor = 0;
      plan.live = false;
    }
  }
  return out;
}

async function load(): Promise<Record<PlanId, DevPlan>> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return structuredClone(PLAN_DEFAULTS);
  try {
    return mergePlans(JSON.parse(row.value));
  } catch {
    return structuredClone(PLAN_DEFAULTS);
  }
}

export async function getPlans(): Promise<Record<PlanId, DevPlan>> {
  return cachedSetting(KEY, load);
}

export async function getPlan(id: string | null | undefined): Promise<DevPlan> {
  const plans = await getPlans();
  return isPlanId(id) ? plans[id] : plans.sandbox;
}

/** Save the editable fields of every plan. Values outside their bounds are refused by the route's schema. */
export async function setPlans(next: Record<PlanId, Partial<DevPlan>>, updatedBy: string): Promise<Record<PlanId, DevPlan>> {
  const merged = mergePlans(next);
  await prisma.platformSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(merged), updatedBy },
    create: { key: KEY, value: JSON.stringify(merged), updatedBy },
  });
  invalidateSetting(KEY);
  return merged;
}
