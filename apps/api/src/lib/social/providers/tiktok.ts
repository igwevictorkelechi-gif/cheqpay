// apps/api/src/lib/social/providers/tiktok.ts
//
// TikTok through the Content Posting API (Direct Post). Access tokens last a day
// and are refreshed before posting. Videos are uploaded as one chunk (we cap
// files at 50 MB; TikTok takes a single chunk up to 64 MB). Photo posts must be
// PULLED by TikTok from a domain verified in the TikTok developer portal, so
// they are served from our own API domain (see /api/social/media).
//
// Until TikTok audits the app, it only accepts private ("only me") posts:
// TIKTOK_APP_AUDITED keeps posts private until it is set to "true".

import { getEnv } from "../../env";
import { clip, expiresIn, form, http, qs } from "./http";
import {
  SocialError,
  transientStatus,
  type PublishContext,
  type RefreshedTokens,
  type SocialProvider,
  type StepResult,
} from "./types";

const OPEN = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish"];

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

function check<T>(r: { status: number; ok: boolean; json: unknown }, what: string): T {
  const b = r.json as TikTokEnvelope<T>;
  const code = b.error?.code;
  if (r.ok && (!code || code === "ok")) return (b.data ?? {}) as T;
  const msg = clip(b.error?.message || code || `HTTP ${r.status}`);
  const reconnect = r.status === 401 || code === "access_token_invalid" || code === "scope_not_authorized";
  const retryable = !reconnect && (transientStatus(r.status) || code === "rate_limit_exceeded" || code === "internal_error");
  throw new SocialError(`${what}: ${msg}`, retryable, reconnect);
}

async function tokenRequest(fields: Record<string, string>): Promise<RefreshedTokens & { openId?: string }> {
  const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET } = getEnv();
  const r = await http<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    open_id?: string;
    error?: string;
    error_description?: string;
  }>(`${OPEN}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_key: TIKTOK_CLIENT_KEY, client_secret: TIKTOK_CLIENT_SECRET, ...fields }),
  });
  const t = r.json;
  if (!r.ok || !t.access_token) {
    throw new SocialError(`TikTok login: ${clip(t.error_description || t.error || `HTTP ${r.status}`)}`, transientStatus(r.status));
  }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    tokenExpiresAt: expiresIn(t.expires_in),
    refreshExpiresAt: expiresIn(t.refresh_expires_in),
    openId: t.open_id,
  };
}

const json = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" });

export const tiktokProvider: SocialProvider = {
  id: "tiktok",
  label: "TikTok",
  platforms: ["tiktok"],
  usesPkce: false,
  configured: () => Boolean(getEnv().TIKTOK_CLIENT_KEY && getEnv().TIKTOK_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${qs({
      client_key: getEnv().TIKTOK_CLIENT_KEY,
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    })}`;
  },

  async exchange({ code, redirectUri }) {
    const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const info = check<{ user?: { open_id?: string; display_name?: string; avatar_url?: string; username?: string } }>(
      await http(`${OPEN}/user/info/?${qs({ fields: "open_id,avatar_url,display_name,username" })}`, {
        headers: { authorization: `Bearer ${t.accessToken}` },
      }),
      "Reading your TikTok profile",
    );
    const u = info.user ?? {};
    return [
      {
        platform: "tiktok",
        externalId: u.open_id ?? t.openId ?? "",
        name: u.display_name || u.username || "TikTok account",
        username: u.username ?? null,
        avatarUrl: u.avatar_url ?? null,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        tokenExpiresAt: t.tokenExpiresAt,
        refreshExpiresAt: t.refreshExpiresAt,
      },
    ];
  },

  async refresh(account) {
    if (!account.refreshToken) throw new SocialError("TikTok login expired. Reconnect the account.", false, true);
    try {
      return await tokenRequest({ grant_type: "refresh_token", refresh_token: account.refreshToken });
    } catch (err) {
      if (err instanceof SocialError && !err.retryable) throw new SocialError("TikTok login expired. Reconnect the account.", false, true);
      throw err;
    }
  },

  publish: publishTikTok,
};

async function privacyLevel(token: string): Promise<string> {
  const info = check<{ privacy_level_options?: string[] }>(
    await http(`${OPEN}/post/publish/creator_info/query/`, { method: "POST", headers: json(token), body: "{}" }),
    "Checking the TikTok account",
  );
  const options = info.privacy_level_options ?? [];
  if (getEnv().TIKTOK_APP_AUDITED && options.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  return "SELF_ONLY";
}

async function publishTikTok(ctx: PublishContext): Promise<StepResult> {
  const token = ctx.account.accessToken;
  const stage = { ...ctx.stage };
  const video = ctx.media.find((m) => m.kind === "video");
  const images = ctx.media.filter((m) => m.kind === "image");

  if (!stage.publishId) {
    const privacy = await privacyLevel(token);
    if (video) {
      const bytes = await ctx.bytes(video);
      const init = check<{ publish_id: string; upload_url: string }>(
        await http(`${OPEN}/post/publish/video/init/`, {
          method: "POST",
          headers: json(token),
          body: JSON.stringify({
            post_info: { title: ctx.caption.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
            source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
          }),
        }),
        "Starting the TikTok upload",
      );
      const put = await http(init.upload_url, {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": String(bytes.length),
          "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
        },
        body: new Uint8Array(bytes),
        timeoutMs: 180_000,
      });
      if (!put.ok) throw new SocialError(`Uploading the video to TikTok failed (HTTP ${put.status}).`, transientStatus(put.status));
      stage.publishId = init.publish_id;
    } else {
      const first = ctx.caption.split("\n")[0] ?? "";
      const init = check<{ publish_id: string }>(
        await http(`${OPEN}/post/publish/content/init/`, {
          method: "POST",
          headers: json(token),
          body: JSON.stringify({
            post_info: { title: first.slice(0, 90), description: ctx.caption.slice(0, 4000), privacy_level: privacy, disable_comment: false, auto_add_music: true },
            source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: images.map((m) => ctx.proxiedUrl(m)) },
            post_mode: "DIRECT_POST",
            media_type: "PHOTO",
          }),
        }),
        "Sending the photos to TikTok",
      );
      stage.publishId = init.publish_id;
    }
    stage.privacy = privacy;
    ctx.stage.publishId = stage.publishId;
    return { done: false, stage, retryInSec: 20 };
  }

  const st = check<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
    await http(`${OPEN}/post/publish/status/fetch/`, {
      method: "POST",
      headers: json(token),
      body: JSON.stringify({ publish_id: stage.publishId }),
    }),
    "Checking the TikTok post",
  );
  if (st.status === "FAILED") throw new SocialError(`TikTok couldn't publish it: ${clip(st.fail_reason ?? "failed")}`);
  if (st.status !== "PUBLISH_COMPLETE") return { done: false, stage, retryInSec: 20 };
  const postId = st.publicaly_available_post_id?.[0];
  const handle = ctx.account.username;
  return {
    done: true,
    externalId: String(postId ?? stage.publishId),
    url: postId && handle ? `https://www.tiktok.com/@${handle}/${video ? "video" : "photo"}/${postId}` : null,
  };
}
