import { describe, expect, it } from "vitest";
import { webPushSubscriptionSchema } from "./validation";

const keys = { p256dh: "BPxxxxxxxxxxxxxxxx", auth: "authauthauth" };

describe("web push subscription", () => {
  it("accepts the real browser push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
    ]) {
      expect(webPushSubscriptionSchema.safeParse({ endpoint, keys }).success, endpoint).toBe(true);
    }
  });

  it("refuses any other URL, so the API can't be pointed at arbitrary hosts", () => {
    for (const endpoint of [
      "https://evil.example/collect",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      expect(webPushSubscriptionSchema.safeParse({ endpoint, keys }).success, endpoint).toBe(false);
    }
  });
});
