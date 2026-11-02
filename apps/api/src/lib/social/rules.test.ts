import { describe, expect, it } from "vitest";
import {
  captionLength,
  effectiveCaption,
  retryDelaySeconds,
  settledPostStatus,
  validateForPlatform,
  validatePost,
  validateShape,
  xWeightedLength,
} from "./rules";

describe("xWeightedLength", () => {
  it("counts Latin text one per character", () => {
    expect(xWeightedLength("Happy New Month!")).toBe(16);
  });
  it("counts every link as 23 whatever its length", () => {
    expect(xWeightedLength("Visit https://mycheqpay.com/a/very/long/path/that/goes/on")).toBe("Visit ".length + 23);
  });
  it("weighs emoji and CJK as 2", () => {
    expect(xWeightedLength("💜")).toBe(2);
    expect(xWeightedLength("你好")).toBe(4);
  });
});

describe("captions", () => {
  it("uses a platform override only when it has text", () => {
    const post = { caption: "main", overrides: { x: "short", instagram: "   " } };
    expect(effectiveCaption("x", post)).toBe("short");
    expect(effectiveCaption("instagram", post)).toBe("main");
    expect(effectiveCaption("facebook", post)).toBe("main");
  });
  it("measures X by weight and others by characters", () => {
    expect(captionLength("x", "💜💜")).toBe(4);
    expect(captionLength("instagram", "💜💜")).toBe(2);
  });
});

describe("validation", () => {
  const img = { kind: "image" as const };
  const vid = { kind: "video" as const };

  it("refuses mixing images with a video, or two videos", () => {
    expect(validateShape({ caption: "x", media: [img, vid] })).toContain("Use either images or one video in a post, not both.");
    expect(validateShape({ caption: "x", media: [vid, vid] })).toContain("A post can have one video at most.");
  });

  it("refuses an empty post", () => {
    expect(validateShape({ caption: "  ", media: [] })).toContain("Write a caption or add an image or video.");
  });

  it("knows Instagram and TikTok need media", () => {
    expect(validateForPlatform("instagram", { caption: "hi", media: [] })[0]).toMatch(/needs at least one image/);
    expect(validateForPlatform("tiktok", { caption: "hi", media: [] })[0]).toMatch(/needs at least one image/);
    expect(validateForPlatform("facebook", { caption: "hi", media: [] })).toEqual([]);
  });

  it("caps images per platform", () => {
    const five = Array(5).fill(img);
    expect(validateForPlatform("x", { caption: "hi", media: five })[0]).toMatch(/at most 4 images/);
    expect(validateForPlatform("instagram", { caption: "hi", media: five })).toEqual([]);
  });

  it("checks caption length against each platform, honouring overrides", () => {
    const long = "a".repeat(300);
    expect(validateForPlatform("x", { caption: long, media: [] })[0]).toMatch(/300 characters; the limit is 280/);
    expect(validateForPlatform("x", { caption: long, overrides: { x: "short" }, media: [] })).toEqual([]);
    expect(validateForPlatform("linkedin", { caption: long, media: [] })).toEqual([]);
  });

  it("groups problems by platform", () => {
    const out = validatePost({ caption: "a".repeat(300), media: [] }, ["x", "instagram", "facebook"]);
    expect(Object.keys(out).sort()).toEqual(["instagram", "x"]);
  });
});

describe("lifecycle", () => {
  it("settles a post only when every live target has finished", () => {
    expect(settledPostStatus(["published", "processing"])).toBeNull();
    expect(settledPostStatus(["published", "published"])).toBe("published");
    expect(settledPostStatus(["published", "failed"])).toBe("partially_failed");
    expect(settledPostStatus(["failed", "cancelled"])).toBe("failed");
    expect(settledPostStatus(["published", "cancelled"])).toBe("published");
    expect(settledPostStatus(["cancelled"])).toBe("failed");
  });
  it("backs off 1, 4, then 15 minutes", () => {
    expect([1, 2, 3, 9].map(retryDelaySeconds)).toEqual([60, 240, 900, 900]);
  });
});
