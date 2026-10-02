import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  setVapid: vi.fn(),
  userFind: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
  env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" } as Record<string, string | undefined>,
}));

vi.mock("web-push", () => ({ default: { sendNotification: h.send, setVapidDetails: h.setVapid } }));
vi.mock("@cheqpay/db", () => ({
  prisma: {
    user: { findUnique: h.userFind },
    $queryRawUnsafe: h.query,
    $executeRawUnsafe: h.exec,
  },
}));
vi.mock("./env", () => ({ getEnv: () => h.env }));

import {
  broadcastWebPush,
  messageStats,
  recordReceipt,
  removeSubscription,
  removeSubscriptionBySecret,
  sendWebPush,
  webPushPublicKey,
} from "./webPush";

const sub = (id: string) => ({ id, user_id: "u1", endpoint: `https://fcm.googleapis.com/x/${id}`, p256dh: "k", auth: "a" });
const msg = { title: "Money received", body: "₦5,000 landed", category: "deposits" as const };

beforeEach(() => {
  vi.clearAllMocks();
  h.env = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
  h.userFind.mockResolvedValue({ notificationPrefs: null });
  h.query.mockResolvedValue([sub("s1"), sub("s2")]);
  h.exec.mockResolvedValue(1);
  h.send.mockResolvedValue({});
});

describe("web push", () => {
  it("sends to each of the user's browsers", async () => {
    await expect(sendWebPush("u1", msg)).resolves.toBe(2);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.send.mock.calls[0][1])).toMatchObject({ title: "Money received", category: "deposits" });
  });

  it("respects the user's category opt-out", async () => {
    h.userFind.mockResolvedValue({ notificationPrefs: { deposits: false } });
    await expect(sendWebPush("u1", msg)).resolves.toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("deletes subscriptions the push service says are gone", async () => {
    h.send.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    await sendWebPush("u1", msg);
    const del = h.exec.mock.calls.find((c) => String(c[0]).startsWith("DELETE"));
    expect(del?.[1]).toEqual(["s1"]);
  });

  it("does nothing, and never throws, when keys aren't configured", async () => {
    h.env = {};
    expect(webPushPublicKey()).toBeNull();
  });

  it("only ever removes the caller's own subscription", async () => {
    await removeSubscription("u1", "https://fcm.googleapis.com/x/s1");
    const [sql, uid] = h.exec.mock.calls.at(-1)!;
    expect(sql).toMatch(/WHERE user_id = \$1::uuid AND endpoint = \$2/);
    expect(uid).toBe("u1");
  });

  it("gives every notification an id, high urgency and a receipt address", async () => {
    vi.stubEnv("PUBLIC_API_URL", "https://api.example.com/");
    await sendWebPush("u1", msg);
    const body = JSON.parse(h.send.mock.calls[0][1]);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.receipt).toBe("https://api.example.com/api/push/web/receipt");
    expect(h.send.mock.calls[0][2]).toMatchObject({ urgency: "high" });
    // Both browsers got the same id, and the message was recorded with its reach.
    expect(JSON.parse(h.send.mock.calls[1][1]).id).toBe(body.id);
    const rec = h.exec.mock.calls.find((c) => String(c[0]).includes("INSERT INTO web_push_messages"));
    expect(rec?.slice(1)).toEqual([body.id, "user", "Money received", 2]);
    vi.unstubAllEnvs();
  });

  it("broadcasts under one id and reports how many push services accepted it", async () => {
    h.query.mockResolvedValue([{ ...sub("s1"), prefs: null }, { ...sub("s2"), prefs: { updates: false } }]);
    const res = await broadcastWebPush({ title: "Rate", body: "Buy 1359", category: "updates" });
    expect(res.accepted).toBe(1);
    expect(JSON.parse(h.send.mock.calls[0][1]).id).toBe(res.id);
  });

  it("records a receipt only against a known message and subscription", async () => {
    h.exec.mockResolvedValue(0);
    await expect(recordReceipt("6f1c2b1e-1111-4222-8333-944445555666", "https://x", "delivered")).resolves.toBe(false);
    const [sql] = h.exec.mock.calls.at(-1)!;
    expect(sql).toMatch(/FROM web_push_messages m, web_push_subscriptions s/);
    expect(sql).toMatch(/delivered_at/);
  });

  it("reads a broadcast's stats", async () => {
    h.query.mockResolvedValue([{ id: "m1", title: "Rate", accepted: 4, delivered: 3n, opened: 1n }]);
    await expect(messageStats("m1")).resolves.toEqual({ id: "m1", title: "Rate", accepted: 4, delivered: 3, opened: 1 });
  });

  it("lets a signed-out browser remove itself only with its auth secret", async () => {
    await removeSubscriptionBySecret("https://fcm.googleapis.com/x/s1", "secret");
    const [sql, endpoint, auth] = h.exec.mock.calls.at(-1)!;
    expect(sql).toMatch(/WHERE endpoint = \$1 AND auth = \$2/);
    expect([endpoint, auth]).toEqual(["https://fcm.googleapis.com/x/s1", "secret"]);
  });
});
