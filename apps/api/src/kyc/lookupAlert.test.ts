import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("@/lib/adminAlert", () => ({ notifyAdminAlert: h.alert }));

import { MapleradError } from "@/lib/maplerad/client";
import { alertLookupFailure, classifyLookupFailure, resetLookupAlertThrottle } from "./lookupAlert";

beforeEach(() => {
  vi.clearAllMocks();
  h.alert.mockResolvedValue(undefined);
  resetLookupAlertThrottle();
});

describe("classifyLookupFailure", () => {
  it("recognises the failures seen in production", () => {
    expect(classifyLookupFailure(new MapleradError("insufficient balance", 400))).toBe("balance");
    expect(classifyLookupFailure(new MapleradError("Unauthorized", 401))).toBe("auth");
    expect(classifyLookupFailure(new TypeError("fetch failed"))).toBe("unreachable");
    expect(classifyLookupFailure(new MapleradError("MAPLERAD_SECRET_KEY is not configured", 0))).toBe("auth");
    expect(classifyLookupFailure(new MapleradError("Bad gateway", 502))).toBe("provider_error");
  });

  it("does not treat an unknown BVN as an outage", () => {
    expect(classifyLookupFailure(new MapleradError("BVN not found", 404))).toBeNull();
    expect(classifyLookupFailure(new MapleradError("Invalid BVN", 400))).toBeNull();
  });
});

describe("alertLookupFailure", () => {
  it("alerts ops once per hour per kind", async () => {
    const t = 1_000_000;
    expect(await alertLookupFailure(new MapleradError("insufficient balance", 400), t)).toBe(true);
    expect(await alertLookupFailure(new MapleradError("insufficient balance", 400), t + 60_000)).toBe(false);
    expect(await alertLookupFailure(new MapleradError("Unauthorized", 401), t + 60_000)).toBe(true);
    expect(await alertLookupFailure(new MapleradError("insufficient balance", 400), t + 61 * 60_000)).toBe(true);
    expect(h.alert).toHaveBeenCalledTimes(3);
    expect(h.alert.mock.calls[0][0]).toContain("top up");
  });

  it("stays quiet for a BVN the registry doesn't know", async () => {
    expect(await alertLookupFailure(new MapleradError("BVN not found", 404))).toBe(false);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("never throws when the webhook fails", async () => {
    h.alert.mockRejectedValue(new Error("webhook down"));
    await expect(alertLookupFailure(new TypeError("fetch failed"))).resolves.toBe(true);
  });
});
