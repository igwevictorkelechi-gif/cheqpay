import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: h.limit }));

import { POST } from "./route";

const post = (body: unknown, raw?: string) =>
  POST(new Request("https://api.example/api/client-errors", { method: "POST", body: raw ?? JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.limit.mockResolvedValue(undefined);
});

describe("client error reports", () => {
  it("logs the error without the query string", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ message: "boom", name: "TypeError", path: "/transaction/?id=secret", stack: "a\nb" });
    expect(res.status).toBe(202);
    const line = spy.mock.calls.find((c) => c[0] === "[client-error]")![1] as string;
    expect(JSON.parse(line)).toMatchObject({ name: "TypeError", message: "boom", path: "/transaction/" });
    expect(line).not.toContain("secret");
    spy.mockRestore();
  });

  it("refuses oversized or malformed reports", async () => {
    expect((await post(null, "x".repeat(5_000))).status).toBe(413);
    expect((await post({ nope: true })).status).toBe(422);
  });

  it("is rate-limited per address", async () => {
    h.limit.mockRejectedValueOnce(Object.assign(new Error("slow down"), { status: 429 }));
    const res = await post({ message: "x" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.limit).toHaveBeenCalledWith(expect.stringMatching(/^client-errors:/), 20, 60_000);
  });
});
