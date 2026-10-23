import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { ApiError, isProviderOutage, toErrorResponse } from "./http";
import { BillPaymentError } from "@/payments/types";

const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("provider outages", () => {
  it("recognises the partner's 5xx answers and network failures", () => {
    expect(isProviderOutage(new BillPaymentError("x failed", "HTTP 503", 503))).toBe(true);
    expect(isProviderOutage(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
    expect(isProviderOutage(fetchFailed("ECONNRESET"))).toBe(true);
  });

  it("leaves refusals, validation and our own bugs alone", () => {
    expect(isProviderOutage(new BillPaymentError("x failed", "insufficient balance", 400))).toBe(false);
    expect(isProviderOutage(new BillPaymentError("Invalid bill amount", "Amount must be a positive number"))).toBe(false);
    expect(isProviderOutage(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isProviderOutage(fetchFailed("SOMETHING_ELSE"))).toBe(false);
    expect(isProviderOutage(new ApiError(400, "bad"))).toBe(false);
  });

  it("answers 503 with a plain message that never names the partner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = toErrorResponse(new BillPaymentError("Maplerad POST /institutions/resolve failed", "HTTP 503", 503));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("provider_unavailable");
    expect(JSON.stringify(body)).not.toMatch(/maplerad|institutions/i);

    expect(toErrorResponse(new Error("boom")).status).toBe(500);
  });
});
