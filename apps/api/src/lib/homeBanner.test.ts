import { beforeEach, describe, expect, it, vi } from "vitest";

// platform_settings as an in-memory map, so the banner rows behave as stored.
const h = vi.hoisted(() => ({ rows: new Map<string, { value: string; updatedBy?: string }>(), audit: vi.fn(), actor: vi.fn() }));
vi.mock("@cheqpay/db", () => ({
  prisma: {
    platformSetting: {
      findUnique: async ({ where: { key } }: { where: { key: string } }) => {
        const r = h.rows.get(key);
        return r ? { key, ...r } : null;
      },
      findMany: async ({ where: { key } }: { where: { key: { in: string[] } } }) =>
        key.in.filter((k) => h.rows.has(k)).map((k) => ({ key: k, ...h.rows.get(k)! })),
      upsert: async ({ where: { key }, update }: { where: { key: string }; update: { value: string; updatedBy?: string } }) => {
        h.rows.set(key, update);
        return {};
      },
      deleteMany: async ({ where: { key } }: { where: { key: string | { in: string[] } } }) => {
        for (const k of typeof key === "string" ? [key] : key.in) h.rows.delete(k);
        return {};
      },
    },
    auditLog: { create: h.audit },
  },
}));
vi.mock("@/lib/adminGuard", () => ({ requireAdminActor: h.actor }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));

import { decodeDataImage, isAllowedBannerImage, listHomeBanners } from "./homeBanner";
import { GET as publicGet } from "../app/api/home-banner/route";
import { GET as imageGet } from "../app/api/home-banner/image/route";
import { GET as adminList, POST as adminCreate } from "../app/api/admin/home-banner/route";
import { PUT as adminUpdate, DELETE as adminDelete } from "../app/api/admin/home-banner/[id]/route";
import { PUT as adminOrder } from "../app/api/admin/home-banner/order/route";

// A 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const API = "https://api.test";

const req = (path: string, method = "GET", body?: object) =>
  new Request(`${API}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

async function create(over: object = {}) {
  const res = await json(await adminCreate(req("/api/admin/home-banner", "POST", { enabled: true, imageUrl: PNG, title: null, message: null, linkUrl: "/crypto", ...over })));
  expect(res.status).toBe(200);
  return res.body.banner as { id: string; version: string; imageUrl: string | null };
}

beforeEach(() => {
  h.rows.clear();
  vi.clearAllMocks();
  h.audit.mockResolvedValue({});
  h.actor.mockResolvedValue({ email: "admin@cheqpay.com" });
});

describe("banner images", () => {
  it("accepts uploaded PNG/JPEG/WebP and https, nothing else", () => {
    expect(isAllowedBannerImage(PNG)).toBe(true);
    expect(isAllowedBannerImage("https://cdn.example.com/b.jpg")).toBe(true);
    expect(isAllowedBannerImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isAllowedBannerImage("http://example.com/b.jpg")).toBe(false);
  });

  it("decodes an upload to its bytes and type", () => {
    const img = decodeDataImage(PNG)!;
    expect(img.contentType).toBe("image/png");
    expect(img.bytes.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("the banner from before the carousel", () => {
  it("moves into the carousel, keeping its picture and staying live", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    h.rows.set("home_banner", { value: JSON.stringify({ enabled: true, imageUrl: PNG, title: null, message: null, linkUrl: null, id }) });

    const { body } = await json(await publicGet(req("/api/home-banner")));
    expect(body.banners).toHaveLength(1);
    expect(body.banners[0].id).toBe(id);
    expect(body.banner).toEqual(body.banners[0]);
    expect(h.rows.has("home_banner")).toBe(false);
    expect(h.rows.get(`home_banner_image:${id}`)?.value).toBe(PNG);

    const img = await imageGet(req(body.banners[0].imageUrl.replace(API, "")));
    expect(img.status).toBe(200);
  });
});

describe("the carousel", () => {
  it("lists only live banners, in order, without carrying the pictures", async () => {
    const a = await create({ title: "A" });
    await create({ title: "B", enabled: false });
    const c = await create({ title: "C", imageUrl: "https://cdn.test/c.jpg" });

    const { body } = await json(await publicGet(req("/api/home-banner")));
    expect(body.banners.map((b: { title: string }) => b.title)).toEqual(["A", "C"]);
    expect(body.banners[0].imageUrl).toBe(`${API}/api/home-banner/image?id=${a.id}&v=${a.version}`);
    expect(body.banners[1].imageUrl).toBe("https://cdn.test/c.jpg");
    expect(JSON.stringify(body)).not.toContain("base64");
    expect(c.imageUrl).toBe("https://cdn.test/c.jpg");
  });

  it("serves each picture, cached for good under its current version only", async () => {
    const a = await create();
    const fresh = await imageGet(req(`/api/home-banner/image?id=${a.id}&v=${a.version}`));
    expect(fresh.headers.get("content-type")).toBe("image/png");
    expect(fresh.headers.get("cache-control")).toContain("immutable");
    const stale = await imageGet(req(`/api/home-banner/image?id=${a.id}&v=old`));
    expect(stale.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await imageGet(req("/api/home-banner/image?id=nope"))).status).toBe(404);
  });

  it("keeps the stored picture when an edit sends its own URL back, with a new version", async () => {
    const a = await create({ title: "Old" });
    const { body } = await json(await adminUpdate(req(`/api/admin/home-banner/${a.id}`, "PUT", { enabled: true, imageUrl: a.imageUrl, title: "New", message: null, linkUrl: null }), ctx(a.id)));
    expect(body.banner.title).toBe("New");
    expect(body.banner.image).toBe("upload");
    expect(body.banner.version).not.toBe(a.version);
    expect(h.rows.get(`home_banner_image:${a.id}`)?.value).toBe(PNG);
  });

  it("drops the stored picture when it is removed", async () => {
    const a = await create({ title: "T" });
    await adminUpdate(req(`/api/admin/home-banner/${a.id}`, "PUT", { enabled: true, imageUrl: null, title: "T", message: null, linkUrl: null }), ctx(a.id));
    expect(h.rows.has(`home_banner_image:${a.id}`)).toBe(false);
  });

  it("reorders, and refuses an order that doesn't match the banners", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    expect((await adminOrder(req("/api/admin/home-banner/order", "PUT", { order: [b.id, a.id] }))).status).toBe(200);
    expect((await listHomeBanners()).map((x) => x.title)).toEqual(["B", "A"]);
    expect((await adminOrder(req("/api/admin/home-banner/order", "PUT", { order: [a.id] }))).status).toBe(409);
  });

  it("deletes a banner with its picture", async () => {
    const a = await create();
    const b = await create();
    expect((await adminDelete(req(`/api/admin/home-banner/${a.id}`, "DELETE"), ctx(a.id))).status).toBe(200);
    expect((await listHomeBanners()).map((x) => x.id)).toEqual([b.id]);
    expect(h.rows.has(`home_banner_image:${a.id}`)).toBe(false);
    expect((await adminDelete(req(`/api/admin/home-banner/${a.id}`, "DELETE"), ctx(a.id))).status).toBe(404);
  });

  it("holds at most 8 banners", async () => {
    for (let i = 0; i < 8; i++) await create({ imageUrl: null, title: `B${i}` });
    const res = await adminCreate(req("/api/admin/home-banner", "POST", { enabled: true, imageUrl: null, title: "one too many", message: null, linkUrl: null }));
    expect(res.status).toBe(422);
  });

  it("gives the admin every banner with a URL for its picture", async () => {
    const a = await create({ enabled: false });
    const { body } = await json(await adminList(req("/api/admin/home-banner")));
    expect(body.banners[0]).toMatchObject({ id: a.id, enabled: false, imageUrl: `${API}/api/home-banner/image?id=${a.id}&v=${a.version}` });
  });

  it("refuses an empty banner, an SVG upload and an unsafe link", async () => {
    const bad = (over: object) =>
      adminCreate(req("/api/admin/home-banner", "POST", { enabled: true, imageUrl: PNG, title: null, message: null, linkUrl: null, ...over }));
    expect((await bad({ imageUrl: null })).status).toBe(422);
    expect((await bad({ imageUrl: "data:image/svg+xml;base64,PHN2Zz4=" })).status).toBe(422);
    expect((await bad({ linkUrl: "javascript:alert(1)" })).status).toBe(422);
    expect(h.rows.size).toBe(0);
  });
});
