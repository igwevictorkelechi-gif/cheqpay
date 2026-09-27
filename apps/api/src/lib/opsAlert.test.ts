import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("./adminAlert", () => ({ notifyAdminAlert: h.alert }));

import { alertOpsOnce, resetOpsAlertThrottle } from "./opsAlert";

beforeEach(() => {
  vi.clearAllMocks();
  h.alert.mockResolvedValue(undefined);
  resetOpsAlertThrottle();
});

describe("alertOpsOnce", () => {
  it("alerts once per key per hour", async () => {
    const t = 5_000_000;
    expect(await alertOpsOnce("bill-failed:data", "a", undefined, t)).toBe(true);
    expect(await alertOpsOnce("bill-failed:data", "a", undefined, t + 60_000)).toBe(false);
    expect(await alertOpsOnce("card-issue-failed", "b", undefined, t + 60_000)).toBe(true);
    expect(await alertOpsOnce("bill-failed:data", "a", undefined, t + 61 * 60_000)).toBe(true);
    expect(h.alert).toHaveBeenCalledTimes(3);
  });

  it("never throws when the webhook fails", async () => {
    h.alert.mockRejectedValue(new Error("down"));
    await expect(alertOpsOnce("k", "x")).resolves.toBe(true);
  });
});
