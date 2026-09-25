import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  otp: vi.fn(),
  record: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("@/lib/adminGuard", () => ({
  requireAdminActor: h.actor,
  requireAdminOtp: h.otp,
  recordAdminAction: h.record,
}));
vi.mock("@/lib/push", () => ({ broadcastPush: h.broadcast }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));

import { ApiError } from "@/lib/http";
import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("https://api/x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ email: "admin@cheqpay.com", role: "super" });
  h.otp.mockResolvedValue(undefined);
  h.broadcast.mockResolvedValue(42);
});

describe("admin broadcast", () => {
  it("sends, audits, and reports the reach", async () => {
    const res = await call({ title: "New: USD cards", body: "Get a dollar card in minutes.", url: "/cards", category: "updates" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 42 });
    expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({ category: "updates", url: "/cards" }));
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "admin.broadcast.sent" }));
  });

  it("needs a fresh authenticator code", async () => {
    h.otp.mockRejectedValue(new ApiError(403, "code", "otp_required"));
    const res = await call({ title: "Hello there", body: "Body text", category: "updates" });
    expect(res.status).toBe(403);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("refuses a link to another site", async () => {
    for (const url of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
      const res = await call({ title: "Hello there", body: "Body text", url, category: "updates" });
      expect(res.status, url).toBe(422);
    }
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("only goes to the news or promotions audiences", async () => {
    const res = await call({ title: "Hello there", body: "Body text", category: "security" });
    expect(res.status).toBe(422);
  });
});
