import { describe, expect, it } from "vitest";
import { detectIosInstall, guideDue, LATER_MS, quietPath } from "./iosInstall";

const UA = {
  safari18: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  safari26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  chrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98",
  facebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/470.0.0.43.109]",
  webview: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("detectIosInstall", () => {
  it("points at the bottom toolbar's Share on iPhone Safari 18", () => {
    const g = detectIosInstall({ userAgent: UA.safari18 })!;
    expect(g).toMatchObject({ device: "iphone", browser: "safari", safariVersion: 18, arrow: "bottom-center" });
    expect(g.steps.map((s) => s.bold)).toEqual(["Share", "Add to Home Screen", "Add"]);
  });

  it("goes through ••• first on iPhone Safari 26", () => {
    const g = detectIosInstall({ userAgent: UA.safari26 })!;
    expect(g.arrow).toBe("bottom-right");
    expect(g.steps.map((s) => s.bold)).toEqual(["•••", "Share", "Add to Home Screen", "Add"]);
  });

  it("points at the address bar for Chrome and Firefox on iOS", () => {
    expect(detectIosInstall({ userAgent: UA.chrome })).toMatchObject({ browser: "chrome", arrow: "top-right" });
    expect(detectIosInstall({ userAgent: UA.firefox })).toMatchObject({ browser: "firefox", arrow: "top-right" });
  });

  it("sends in-app browsers to Safari first", () => {
    for (const ua of [UA.instagram, UA.facebook, UA.webview]) {
      const g = detectIosInstall({ userAgent: ua })!;
      expect(g.browser).toBe("inapp");
      expect(g.steps[1].bold).toBe("Open in Safari");
    }
  });

  it("points top right on iPad, including desktop-mode iPadOS", () => {
    expect(detectIosInstall({ userAgent: UA.ipad })).toMatchObject({ device: "ipad", arrow: "top-right" });
    expect(detectIosInstall({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })).toMatchObject({ device: "ipad", browser: "safari" });
  });

  it("ignores a Mac, Android and desktop", () => {
    expect(detectIosInstall({ userAgent: UA.ipadDesktop, maxTouchPoints: 0 })).toBeNull();
    expect(detectIosInstall({ userAgent: UA.android })).toBeNull();
  });
});

describe("guideDue", () => {
  it("shows once, then respects done and later", () => {
    const now = 1_800_000_000_000;
    expect(guideDue(null, now)).toBe(true);
    expect(guideDue("done", now)).toBe(false);
    expect(guideDue(`later:${now - 1000}`, now)).toBe(false);
    expect(guideDue(`later:${now - LATER_MS}`, now)).toBe(true);
    expect(guideDue("garbage", now)).toBe(true);
  });
});

describe("quietPath", () => {
  it("stays out of the sign-in pages", () => {
    expect(quietPath("/login/")).toBe(true);
    expect(quietPath("/verify-otp")).toBe(true);
    expect(quietPath("/")).toBe(false);
    expect(quietPath("/loginx")).toBe(false);
  });
});
