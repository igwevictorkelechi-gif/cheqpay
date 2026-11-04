import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  META_APP_ID: "meta-app",
  META_APP_SECRET: "meta-secret",
  META_GRAPH_VERSION: "v23.0",
  X_CLIENT_ID: "x-id",
  X_CLIENT_SECRET: "x-secret",
  TIKTOK_CLIENT_KEY: "tt-key",
  TIKTOK_CLIENT_SECRET: "tt-secret",
  TIKTOK_APP_AUDITED: false,
  LINKEDIN_CLIENT_ID: "li-id",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  LINKEDIN_API_VERSION: undefined as string | undefined,
}));
vi.mock("../env", () => ({ getEnv: () => env }));

import { linkedinProvider, linkedinVersion, toLittleText } from "./providers/linkedin";
import { metaProvider } from "./providers/meta";
import { tiktokProvider } from "./providers/tiktok";
import { SocialError, type MediaForPublish, type PublishContext } from "./providers/types";
import { xProvider } from "./providers/x";

// ---- A scripted fetch: each call takes the next response; every request is kept.
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
let script: Reply[] = [];
let calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];

beforeEach(() => {
  script = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ url: String(url), method: init.method ?? "GET", body, headers: (init.headers ?? {}) as Record<string, string> });
      const r = script.shift() ?? { body: {} };
      return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const img = (id: string): MediaForPublish => ({ id, kind: "image", mime: "image/jpeg", size: 10, storagePath: `p/${id}.jpg` });
const vid: MediaForPublish = { id: "v1", kind: "video", mime: "video/mp4", size: 12, storagePath: "p/v1.mp4" };

function ctx(platform: PublishContext["account"]["platform"], media: MediaForPublish[], over: Partial<PublishContext> = {}): PublishContext {
  return {
    account: { id: "a1", platform, externalId: platform === "linkedin" ? "urn:li:organization:42" : "ext1", name: "CheqPay", username: "cheqpay", accessToken: "tok", refreshToken: "ref", tokenExpiresAt: null, meta: {} },
    caption: "Happy New Month 💜",
    media,
    stage: {},
    signedUrl: async (m) => `https://storage.example/${m.id}`,
    proxiedUrl: (m) => `https://api.example/api/social/media/${m.id}?sig=s`,
    bytes: async () => Buffer.from("0123456789AB"),
    ...over,
  };
}

describe("Meta", () => {
  it("posts one photo to a Facebook Page and links the post", async () => {
    script = [{ body: { id: "photo1", post_id: "page_post1" } }];
    const r = await metaProvider.publish(ctx("facebook", [img("i1")]));
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/ext1/photos");
    expect(calls[0].body).toMatchObject({ url: "https://storage.example/i1", message: "Happy New Month 💜", access_token: "tok" });
    expect(r).toEqual({ done: true, externalId: "page_post1", url: "https://www.facebook.com/page_post1" });
  });

  it("uploads several photos unpublished, then attaches them to one feed post", async () => {
    script = [{ body: { id: "p1" } }, { body: { id: "p2" } }, { body: { id: "feed1" } }];
    const r = await metaProvider.publish(ctx("facebook", [img("i1"), img("i2")]));
    expect(calls[0].body).toMatchObject({ published: "false" });
    expect(calls[2].url).toMatch(/\/ext1\/feed$/);
    expect(calls[2].body).toMatchObject({ "attached_media[0]": '{"media_fbid":"p1"}', "attached_media[1]": '{"media_fbid":"p2"}' });
    expect(r).toMatchObject({ done: true, externalId: "feed1" });
  });

  it("publishes an Instagram photo once its container is ready", async () => {
    script = [{ body: { id: "c1" } }, { body: { status_code: "FINISHED" } }, { body: { id: "m1" } }, { body: { permalink: "https://instagram.com/p/abc" } }];
    const r = await metaProvider.publish(ctx("instagram", [img("i1")]));
    expect(calls.map((c) => c.url.replace("https://graph.facebook.com/v23.0", ""))).toEqual(["/ext1/media", expect.stringMatching(/^\/c1\?/), "/ext1/media_publish", expect.stringMatching(/^\/m1\?/)]);
    expect(calls[2].body).toMatchObject({ creation_id: "c1" });
    expect(r).toEqual({ done: true, externalId: "m1", url: "https://instagram.com/p/abc" });
  });

  it("waits for an Instagram reel to process, then publishes on a later run", async () => {
    script = [{ body: { id: "c9" } }, { body: { status_code: "IN_PROGRESS" } }];
    const first = await metaProvider.publish(ctx("instagram", [vid]));
    expect(calls[0].body).toMatchObject({ media_type: "REELS", video_url: "https://storage.example/v1" });
    expect(first).toEqual({ done: false, stage: { containerId: "c9" }, retryInSec: 30 });

    calls = [];
    script = [{ body: { status_code: "FINISHED" } }, { body: { id: "m9" } }, { body: { permalink: "https://instagram.com/reel/x" } }];
    const second = await metaProvider.publish(ctx("instagram", [vid], { stage: { containerId: "c9" } }));
    expect(calls[0].url).toMatch(/\/c9\?/); // no second container
    expect(second).toMatchObject({ done: true, externalId: "m9" });
  });

  it("asks for a reconnect when the token is no longer valid", async () => {
    script = [{ status: 400, body: { error: { message: "Error validating access token", code: 190 } } }];
    const err = await metaProvider.publish(ctx("facebook", [])).catch((e) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect(err.reconnect).toBe(true);
    expect(err.retryable).toBe(false);
  });

  it("retries rate limits", async () => {
    script = [{ status: 400, body: { error: { message: "Application request limit reached", code: 4 } } }];
    const err = await metaProvider.publish(ctx("facebook", [])).catch((e) => e);
    expect(err.retryable).toBe(true);
  });

  it("turns one login into Page and Instagram accounts", async () => {
    script = [
      { body: { access_token: "short" } },
      { body: { access_token: "long" } },
      { body: { data: [{ id: "pg1", name: "CheqPay", access_token: "pagetok", instagram_business_account: { id: "ig1", username: "cheqpay" } }] } },
    ];
    const profiles = await metaProvider.exchange({ code: "c", redirectUri: "https://api/cb" });
    expect(profiles.map((p) => [p.platform, p.externalId, p.accessToken])).toEqual([
      ["facebook", "pg1", "pagetok"],
      ["instagram", "ig1", "pagetok"],
    ]);
    expect(calls[1].url).toContain("grant_type=fb_exchange_token");
  });
});

describe("X", () => {
  it("uploads images, then posts them with the text", async () => {
    script = [{ body: { data: { id: "m1" } } }, { body: { data: { id: "m2" } } }, { body: { data: { id: "t1" } } }];
    const r = await xProvider.publish(ctx("x", [img("i1"), img("i2")]));
    expect(calls[0].url).toBe("https://api.x.com/2/media/upload");
    expect(calls[2].url).toBe("https://api.x.com/2/tweets");
    expect(calls[2].body).toEqual({ text: "Happy New Month 💜", media: { media_ids: ["m1", "m2"] } });
    expect(calls[2].headers.authorization).toBe("Bearer tok");
    expect(r).toEqual({ done: true, externalId: "t1", url: "https://x.com/cheqpay/status/t1" });
  });

  it("uses PKCE in its login URL", () => {
    const u = new URL(xProvider.authorizeUrl({ state: "s", redirectUri: "https://api/cb", codeChallenge: "chal" }));
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("offline.access");
  });

  it("treats a 401 as needing a reconnect", async () => {
    script = [{ status: 401, body: { title: "Unauthorized" } }];
    const err = await xProvider.publish(ctx("x", [])).catch((e) => e);
    expect(err.reconnect).toBe(true);
  });
});

describe("TikTok", () => {
  it("uploads a video privately until the app is audited, then waits for TikTok", async () => {
    script = [
      { body: { data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } } },
      { body: { data: { publish_id: "pub1", upload_url: "https://upload.tiktok/u" }, error: { code: "ok" } } },
      { status: 201, body: undefined },
    ];
    const r = await tiktokProvider.publish(ctx("tiktok", [vid]));
    expect(calls[1].body).toMatchObject({
      post_info: { privacy_level: "SELF_ONLY" },
      source_info: { source: "FILE_UPLOAD", video_size: 12, chunk_size: 12, total_chunk_count: 1 },
    });
    expect(calls[2]).toMatchObject({ url: "https://upload.tiktok/u", method: "PUT" });
    expect(calls[2].headers["content-range"]).toBe("bytes 0-11/12");
    expect(r).toMatchObject({ done: false, stage: { publishId: "pub1", privacy: "SELF_ONLY" } });
  });

  it("finishes when TikTok reports the post complete", async () => {
    script = [{ body: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [777] }, error: { code: "ok" } } }];
    const r = await tiktokProvider.publish(ctx("tiktok", [vid], { stage: { publishId: "pub1" } }));
    expect(r).toEqual({ done: true, externalId: "777", url: "https://www.tiktok.com/@cheqpay/video/777" });
  });

  it("sends photos from our own domain", async () => {
    script = [
      { body: { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } } },
      { body: { data: { publish_id: "pub2" }, error: { code: "ok" } } },
    ];
    await tiktokProvider.publish(ctx("tiktok", [img("i1")]));
    expect(calls[1].body).toMatchObject({
      media_type: "PHOTO",
      source_info: { source: "PULL_FROM_URL", photo_images: ["https://api.example/api/social/media/i1?sig=s"] },
    });
  });
});

describe("LinkedIn", () => {
  it("escapes little-text syntax and keeps hashtags as hashtags", () => {
    expect(toLittleText("Fees (low) & rates @ #CheqPay_NG *now*")).toBe(
      "Fees \\(low\\) & rates \\@ {hashtag|\\#|CheqPay_NG} \\*now\\*",
    );
  });

  it("uses a recent API version unless one is pinned", () => {
    expect(linkedinVersion(new Date(Date.UTC(2026, 10, 2)))).toBe("202608");
    expect(linkedinVersion(new Date(Date.UTC(2026, 1, 15)))).toBe("202511");
    env.LINKEDIN_API_VERSION = "202601";
    expect(linkedinVersion()).toBe("202601");
    env.LINKEDIN_API_VERSION = undefined;
  });

  it("posts as the organisation and links the new post", async () => {
    script = [{ status: 201, body: undefined, headers: { "x-restli-id": "urn:li:share:9" } }];
    const r = await linkedinProvider.publish(ctx("linkedin", []));
    expect(calls[0].url).toBe("https://api.linkedin.com/rest/posts");
    expect(calls[0].body).toMatchObject({ author: "urn:li:organization:42", visibility: "PUBLIC", lifecycleState: "PUBLISHED" });
    expect(calls[0].headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(r).toEqual({ done: true, externalId: "urn:li:share:9", url: "https://www.linkedin.com/feed/update/urn:li:share:9" });
  });
});
