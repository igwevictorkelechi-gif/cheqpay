import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("./opsAlert", () => ({ alertOpsOnce: h.alert }));

import { Asset } from "@cheqpay/db";
import { MapleradError } from "./maplerad/client";
import { ApiError } from "./http";
import { fxQuoteError } from "./swap";

beforeEach(() => {
  vi.clearAllMocks();
  h.alert.mockResolvedValue(true);
});

describe("fxQuoteError", () => {
  it("explains a direction Maplerad has not enabled, instead of a 500", () => {
    const e = fxQuoteError(
      new MapleradError("NGN exchanges are not enabled for this business", 400),
      Asset.NGN,
      Asset.USD,
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(503);
    expect(e.code).toBe("fx_direction_unavailable");
    expect(e.message).toContain("naira to dollars isn't available");
    expect(e.message).toContain("You can still convert dollars to naira");
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect(h.alert.mock.calls[0][1]).toContain("enable NGN exchanges");
  });

  it("gives a retryable message when the provider is unreachable", () => {
    const e = fxQuoteError(new TypeError("fetch failed"), Asset.USD, Asset.NGN);
    expect(e.status).toBe(502);
    expect(e.code).toBe("fx_quote_failed");
    expect(e.message).toContain("try again shortly");
  });

  it("passes our own errors through untouched", () => {
    const own = new ApiError(422, "Amount too small", "too_small");
    expect(fxQuoteError(own, Asset.NGN, Asset.USD)).toBe(own);
    expect(h.alert).not.toHaveBeenCalled();
  });
});
