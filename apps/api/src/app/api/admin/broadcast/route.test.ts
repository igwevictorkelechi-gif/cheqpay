import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  otp: vi.fn(),
  record: vi.fn(),
  broadcast: vi.fn(),
  findMany: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("@/lib/adminGuard", () => ({
  requireAdminActor: h.actor,
  requireAdminOtp: h.otp,
  recordAdminAction: h.record,
}));
vi.mock("@/lib/push", () => ({ broadcastPush: h.broadcast }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@cheqpay/db", () => ({ prisma: { auditLog: { findMany: h.findMany } } }));
vi.mock("@/lib/webPush", () => ({ messagesStats: h.stats }));

import { ApiError } from "@/lib/http";
import { GET, POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("https://api/x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ email: "admin@cheqpay.com", role: "super" });
  h.otp.mockResolvedValue(undefined);
  h.broadcast.mockResolvedValue({ id: "b1", browsers: 40, apps: 2 });
});

describe("admin broadcast", () => {
  it("sends, audits, and reports the reach", async () => {
    const res = await call({ title: "New: USD cards", body: "Get a dollar card in minutes.", url: "/cards", category: "updates" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 42, id: "b1", browsers: 40, apps: 2 });
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

describe("admin broadcast history", () => {
  const id1 = "11111111-1111-4111-8111-111111111111";
  it("lists past sends newest first, with reach and what phones reported", async () => {
    h.findMany.mockResolvedValue([
      { id: "a2", createdAt: new Date("2026-10-06T18:11:12Z"), resourceId: id1,
        details: { actor: "owner@cheqpay.com", title: "Gift cards are here", body: "Sell yours for Naira", category: "updates", url: "/gift-cards", sent: 42, browsers: 40, apps: 2, id: id1 } },
      { id: "a1", createdAt: new Date("2026-09-25T23:12:50Z"), resourceId: null,
        details: { actor: "owner@cheqpay.com", title: "Welcome", body: "Old send", category: "promos", sent: 7 } },
    ]);
    h.stats.mockResolvedValue(new Map([[id1, { accepted: 40, delivered: 31, opened: 9 }]]));
    const res = await GET(new Request("https://api/x"));
    expect(res.status).toBe(200);
    const { broadcasts } = await res.json();
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: "admin.broadcast.sent" }, orderBy: { createdAt: "desc" } }));
    expect(h.stats).toHaveBeenCalledWith([id1]);
    expect(broadcasts[0]).toMatchObject({ title: "Gift cards are here", url: "/gift-cards", devices: 42, browsers: 40, apps: 2, shown: 31, tapped: 9, sentBy: "owner@cheqpay.com" });
    expect(broadcasts[1]).toMatchObject({ title: "Welcome", category: "promos", devices: 7, browsers: null, shown: null, tapped: null, messageId: null });
  });

  it("is for super admins only", async () => {
    h.actor.mockRejectedValue(new ApiError(403, "no", "forbidden"));
    const res = await GET(new Request("https://api/x"));
    expect(res.status).toBe(403);
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
