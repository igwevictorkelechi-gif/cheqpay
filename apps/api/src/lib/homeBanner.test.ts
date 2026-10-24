import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
  actor: vi.fn(),
}));
vi.mock("@cheqpay/db", () => ({
  prisma: {
    platformSetting: { findUnique: h.findUnique, upsert: h.upsert },
    auditLog: { create: h.audit },
  },
}));
vi.mock("@/lib/adminGuard", () => ({ requireAdminActor: h.actor }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));

import { decodeDataImage, isAllowedBannerImage, publicBanner, type HomeBanner } from "./homeBanner";
import { GET as publicGet } from "../app/api/home-banner/route";
import { GET as imageGet } from "../app/api/home-banner/image/route";
import { PUT as adminPut } from "../app/api/admin/home-banner/route";

// A 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const banner = (over: Partial<HomeBanner> = {}): HomeBanner => ({
  id: "b1",
  enabled: true,
  imageUrl: PNG,
  title: "Zero fees",
  message: "All weekend",
  linkUrl: "/deposit",
  ...over,
});
const stored = (b: HomeBanner | null) =>
  h.findUnique.mockResolvedValue(b ? { key: "home_banner", value: JSON.stringify(b) } : null);

beforeEach(() => {
  vi.clearAllMocks();
  h.upsert.mockResolvedValue({});
  h.audit.mockResolvedValue({});
  h.actor.mockResolvedValue({ email: "admin@cheqpay.com" });
});

describe("banner images", () => {
  it("accepts uploaded PNG/JPEG/WebP and https, nothing else", () => {
    expect(isAllowedBannerImage(PNG)).toBe(true);
    expect(isAllowedBannerImage("https://cdn.example.com/b.jpg")).toBe(true);
    expect(isAllowedBannerImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isAllowedBannerImage("http://example.com/b.jpg")).toBe(false);
    expect(isAllowedBannerImage("javascript:alert(1)")).toBe(false);
  });

  it("decodes an upload to its bytes and type", () => {
    const img = decodeDataImage(PNG)!;
    expect(img.contentType).toBe("image/png");
    expect(img.bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(decodeDataImage("https://x.test/a.png")).toBeNull();
  });

  it("points the apps at a versioned image URL instead of inlining the upload", () => {
    expect(publicBanner(banner(), "https://api.test")).toEqual({
      id: "b1",
      imageUrl: "https://api.test/api/home-banner/image?v=b1",
      title: "Zero fees",
      message: "All weekend",
      linkUrl: "/deposit",
    });
    expect(publicBanner(banner({ imageUrl: "https://cdn.test/b.jpg" }), "https://api.test").imageUrl).toBe(
      "https://cdn.test/b.jpg",
    );
  });
});

describe("GET /api/home-banner", () => {
  it("returns the live banner", async () => {
    stored(banner());
    const res = await publicGet(new Request("https://api.test/api/home-banner"));
    expect(await res.json()).toMatchObject({ banner: { id: "b1", imageUrl: "https://api.test/api/home-banner/image?v=b1" } });
  });

  it("returns null when it is switched off or never set", async () => {
    stored(banner({ enabled: false }));
    expect(await (await publicGet(new Request("https://api.test/x"))).json()).toEqual({ banner: null });
    stored(null);
    expect(await (await publicGet(new Request("https://api.test/x"))).json()).toEqual({ banner: null });
  });
});

describe("GET /api/home-banner/image", () => {
  it("serves the upload, cached for good under its own version", async () => {
    stored(banner());
    const res = await imageGet(new Request("https://api.test/api/home-banner/image?v=b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const stale = await imageGet(new Request("https://api.test/api/home-banner/image?v=old"));
    expect(stale.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("is a 404 when there is no uploaded image", async () => {
    stored(banner({ imageUrl: "https://cdn.test/b.jpg" }));
    expect((await imageGet(new Request("https://api.test/api/home-banner/image?v=b1"))).status).toBe(404);
  });
});

describe("PUT /api/admin/home-banner", () => {
  const put = (body: object) =>
    adminPut(new Request("https://api.test/api/admin/home-banner", { method: "PUT", body: JSON.stringify(body) }));
  const base = { enabled: true, imageUrl: PNG, title: "", message: "", linkUrl: "" };

  it("saves an image-only banner with a fresh id and an audit row", async () => {
    const res = await put(base);
    expect(res.status).toBe(200);
    const { banner: saved } = await res.json();
    expect(saved).toMatchObject({ enabled: true, imageUrl: PNG, title: null, message: null, linkUrl: null });
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "admin.home_banner.updated" }) }));
  });

  it("refuses an empty banner, an SVG upload and an unsafe link", async () => {
    expect((await put({ ...base, imageUrl: null })).status).toBe(422);
    expect((await put({ ...base, imageUrl: "data:image/svg+xml;base64,PHN2Zz4=" })).status).toBe(422);
    expect((await put({ ...base, linkUrl: "javascript:alert(1)" })).status).toBe(422);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
