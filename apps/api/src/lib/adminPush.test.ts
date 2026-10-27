import { beforeEach, describe, expect, it, vi } from "vitest";

// Alerts on the admin dashboard go to the browsers of the admins named, and a
// browser the push service says is gone is forgotten.

const h = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
  send: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: { $queryRawUnsafe: h.query, $executeRawUnsafe: h.exec } }));
vi.mock("web-push", () => ({ default: { sendNotification: h.send } }));
vi.mock("./webPush", () => ({ configure: h.configured, webPushPublicKey: () => "pk" }));

import { sendAdminPush } from "./adminPush";

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.mockReturnValue(true);
  h.exec.mockResolvedValue(0);
  h.query.mockResolvedValue([
    { endpoint: "https://push.example/a", p256dh: "p".repeat(20), auth: "a".repeat(10) },
    { endpoint: "https://push.example/gone", p256dh: "p".repeat(20), auth: "a".repeat(10) },
  ]);
  h.send.mockImplementation(async (sub: { endpoint: string }) => {
    if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return {};
  });
});

describe("sendAdminPush", () => {
  it("pushes to the named admins' browsers and forgets the ones that are gone", async () => {
    const sent = await sendAdminPush(["Ops@CheqPay.com"], { title: "New gift card to review", body: "b", url: "/gift-cards", tag: "giftcards" });
    expect(sent).toBe(1);
    expect(h.query.mock.calls[0][1]).toEqual(["ops@cheqpay.com"]);
    const payload = JSON.parse(h.send.mock.calls[0][1]);
    expect(payload).toEqual({ title: "New gift card to review", body: "b", url: "/gift-cards", tag: "giftcards" });
    const deleted = h.exec.mock.calls.find(([sql]) => String(sql).startsWith("DELETE FROM admin_push_subscriptions"));
    expect(deleted?.[1]).toEqual(["https://push.example/gone"]);
  });

  it("does nothing without recipients or push keys, and never throws", async () => {
    await expect(sendAdminPush([], { title: "t", body: "b", url: "/" })).resolves.toBe(0);
    h.configured.mockReturnValue(false);
    await expect(sendAdminPush(["a@x.com"], { title: "t", body: "b", url: "/" })).resolves.toBe(0);
    h.configured.mockReturnValue(true);
    h.query.mockRejectedValue(new Error("db down"));
    await expect(sendAdminPush(["a@x.com"], { title: "t", body: "b", url: "/" })).resolves.toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
});
