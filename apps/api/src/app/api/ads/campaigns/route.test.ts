import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: vi.fn(),
  feature: vi.fn(),
  pin: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: h.user }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: h.feature }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/transactionPin", () => ({ readPin: () => "1234", requireTransactionPin: h.pin }));
vi.mock("@/lib/ads", async () => {
  const real = await vi.importActual<typeof import("@/lib/ads")>("@/lib/ads");
  return { quoteSchema: real.quoteSchema, createCampaign: h.create, listUserCampaigns: h.list };
});

import { ApiError } from "@/lib/http";
import { POST } from "./route";

const body = {
  placements: ["receipt"], startDay: "2030-01-01", days: 2, category: "food", targeting: {},
  businessName: "Mama Put", headline: "Best jollof", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
};
const call = (b: unknown, key: string | null = "k1") =>
  POST(new Request("https://api/x", { method: "POST", body: JSON.stringify(b), headers: key ? { "idempotency-key": key } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1" });
  h.feature.mockResolvedValue(undefined);
  h.pin.mockResolvedValue(undefined);
  h.create.mockResolvedValue({ id: "c1" });
});

describe("POST /api/ads/campaigns", () => {
  it("checks the PIN, then books with defaults filled in", async () => {
    const res = await call(body);
    expect(res.status).toBe(201);
    expect(h.pin).toHaveBeenCalledWith("u1", "1234");
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", idempotencyKey: "k1", placements: ["receipt"],
      targeting: expect.objectContaining({ ageMin: 18, ageMax: 65, frequencyCap: 3, states: [] }),
    }));
  });

  it("needs an Idempotency-Key", async () => {
    expect((await call(body, null)).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a wrong PIN books nothing", async () => {
    h.pin.mockRejectedValue(new ApiError(403, "Wrong PIN", "bad_pin"));
    expect((await call(body)).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("is off when the feature is off", async () => {
    h.feature.mockRejectedValue(new ApiError(503, "Off", "feature_disabled"));
    expect((await call(body)).status).toBe(503);
  });

  it("refuses unknown placements and categories", async () => {
    expect((await call({ ...body, placements: ["popup"] })).status).toBe(422);
    expect((await call({ ...body, category: "weapons" })).status).toBe(422);
  });
});
