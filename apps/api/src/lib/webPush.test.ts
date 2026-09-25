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

import { removeSubscription, sendWebPush, webPushPublicKey } from "./webPush";

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
});
