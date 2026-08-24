import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client logs every Maplerad exchange for diagnosis (see logMaplerad).
 * These tests pin the two properties that make the log safe and useful: the
 * response is logged, and the request's BVN / ID number never is.
 */

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));
}

async function load() {
  process.env.MAPLERAD_SECRET_KEY = "sk-test";
  delete process.env.MAPLERAD_LOG_RESPONSES;
  vi.resetModules();
  return import("./client");
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MAPLERAD_LOG_RESPONSES;
});

describe("mapleradRequest response logging", () => {
  it("logs the response of a successful call", async () => {
    stubFetch(200, { status: true, data: { id: "cus_1", tier: 2 } });
    const { mapleradRequest } = await load();

    await mapleradRequest("/customers/enroll", { method: "POST", body: { first_name: "Ada" } });

    const line = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).toContain("[maplerad] POST /customers/enroll -> HTTP 200 ok=true");
    expect(line).toContain('"id":"cus_1"');
    expect(line).toContain('"tier":2');
  });

  it("redacts the BVN / identification number from the logged request", async () => {
    stubFetch(200, { status: true, data: { id: "cus_1" } });
    const { mapleradRequest } = await load();

    await mapleradRequest("/customers/enroll", {
      method: "POST",
      body: { first_name: "Ada", identification_number: "12345678901", phone: { phone_number: "8031234567" } },
    });

    const line = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).not.toContain("12345678901");
    expect(line).toContain("[redacted]");
    // Non-sensitive context is kept — this is what a tier diagnosis needs.
    expect(line).toContain('"phone_number":"8031234567"');
  });

  it("logs failures via console.error", async () => {
    stubFetch(422, { status: false, message: "phone is required" });
    const { mapleradRequest } = await load();

    await expect(
      mapleradRequest("/customers/enroll", { method: "POST", body: {} }),
    ).rejects.toThrow();

    const line = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).toContain("HTTP 422 ok=false");
    expect(line).toContain("phone is required");
  });

  it("is silenced by MAPLERAD_LOG_RESPONSES=0", async () => {
    stubFetch(200, { status: true, data: { id: "cus_1" } });
    const { mapleradRequest } = await load();
    process.env.MAPLERAD_LOG_RESPONSES = "0";

    await mapleradRequest("/customers/enroll", { method: "POST", body: {} });

    expect(logSpy).not.toHaveBeenCalled();
  });
});
