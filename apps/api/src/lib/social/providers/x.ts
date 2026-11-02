// apps/api/src/lib/social/providers/x.ts
//
// X (Twitter) through API v2 with OAuth 2.0 (PKCE, confidential client). Access
// tokens last two hours and refresh tokens rotate, so the publisher refreshes
// before posting and stores the new pair. Media goes up through v2 media
// upload: one call for an image, chunked initialize/append/finalize for video.
//
// Posting needs an X developer plan that allows writes; the free tier's monthly
// post allowance is small.

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

const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const CHUNK = 4 * 1024 * 1024;

interface XErrorBody {
  title?: string;
  detail?: string;
  error_description?: string;
  errors?: { message?: string; detail?: string }[];
}

function check<T>(r: { status: number; ok: boolean; json: unknown }, what: string): T {
  if (r.ok) return r.json as T;
  const b = r.json as XErrorBody;
  const msg = clip(b.detail || b.errors?.[0]?.detail || b.errors?.[0]?.message || b.error_description || b.title || `HTTP ${r.status}`);
  throw new SocialError(`${what}: ${msg}`, transientStatus(r.status), r.status === 401);
}

const basic = () => {
  const { X_CLIENT_ID, X_CLIENT_SECRET } = getEnv();
  return `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`;
};

async function tokenRequest(fields: Record<string, string>): Promise<RefreshedTokens> {
  const r = await http<{ access_token: string; refresh_token?: string; expires_in?: number }>(`${API}/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: form({ ...fields, client_id: getEnv().X_CLIENT_ID }),
  });
  const t = check<{ access_token: string; refresh_token?: string; expires_in?: number }>(r, "X login");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, tokenExpiresAt: expiresIn(t.expires_in) };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const xProvider: SocialProvider = {
  id: "x",
  label: "X (Twitter)",
  platforms: ["x"],
  usesPkce: true,
  configured: () => Boolean(getEnv().X_CLIENT_ID && getEnv().X_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    return `https://x.com/i/oauth2/authorize?${qs({
      response_type: "code",
      client_id: getEnv().X_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })}`;
  },

  async exchange({ code, redirectUri, codeVerifier }) {
    const t = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier ?? "",
    });
    const me = check<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(
      await http(`${API}/users/me?user.fields=profile_image_url`, { headers: bearer(t.accessToken) }),
      "Reading your X profile",
    );
    return [
      {
        platform: "x",
        externalId: me.data.id,
        name: me.data.name,
        username: me.data.username,
        avatarUrl: me.data.profile_image_url ?? null,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        tokenExpiresAt: t.tokenExpiresAt,
      },
    ];
  },

  async refresh(account) {
    if (!account.refreshToken) throw new SocialError("X login expired. Reconnect the account.", false, true);
    try {
      return await tokenRequest({ grant_type: "refresh_token", refresh_token: account.refreshToken });
    } catch (err) {
      if (err instanceof SocialError && !err.retryable) throw new SocialError("X login expired. Reconnect the account.", false, true);
      throw err;
    }
  },

  publish: publishX,
};

async function uploadImage(ctx: PublishContext, idx: number): Promise<string> {
  const m = ctx.media[idx];
  const body = new FormData();
  body.set("media", new Blob([new Uint8Array(await ctx.bytes(m))], { type: m.mime }), "image.jpg");
  body.set("media_category", "tweet_image");
  body.set("media_type", m.mime);
  const r = check<{ data?: { id?: string } }>(
    await http(`${API}/media/upload`, { method: "POST", headers: bearer(ctx.account.accessToken), body, timeoutMs: 60_000 }),
    "Uploading the image to X",
  );
  if (!r.data?.id) throw new SocialError("X didn't return an id for the uploaded image.", true);
  return r.data.id;
}

interface ProcessingInfo {
  state?: "pending" | "in_progress" | "succeeded" | "failed";
  check_after_secs?: number;
  error?: { message?: string };
}

async function publishX(ctx: PublishContext): Promise<StepResult> {
  const token = ctx.account.accessToken;
  const stage = { ...ctx.stage };
  const video = ctx.media.find((m) => m.kind === "video");
  let mediaIds: string[] = [];

  if (video) {
    if (!stage.videoId) {
      const bytes = await ctx.bytes(video);
      const init = check<{ data: { id: string } }>(
        await http(`${API}/media/upload/initialize`, {
          method: "POST",
          headers: { ...bearer(token), "content-type": "application/json" },
          body: JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.length, media_category: "tweet_video" }),
        }),
        "Starting the video upload to X",
      );
      const id = init.data.id;
      for (let seg = 0, off = 0; off < bytes.length; seg++, off += CHUNK) {
        const part = new FormData();
        part.set("media", new Blob([new Uint8Array(bytes.subarray(off, off + CHUNK))], { type: "application/octet-stream" }), "chunk");
        part.set("segment_index", String(seg));
        check(
          await http(`${API}/media/upload/${id}/append`, { method: "POST", headers: bearer(token), body: part, timeoutMs: 120_000 }),
          "Uploading the video to X",
        );
      }
      const fin = check<{ data?: { processing_info?: ProcessingInfo } }>(
        await http(`${API}/media/upload/${id}/finalize`, { method: "POST", headers: bearer(token) }),
        "Finishing the video upload to X",
      );
      stage.videoId = id;
      ctx.stage.videoId = id;
      const p = fin.data?.processing_info;
      if (p && p.state !== "succeeded") return { done: false, stage, retryInSec: Math.max(5, p.check_after_secs ?? 10) };
    } else {
      const st = check<{ data?: { processing_info?: ProcessingInfo } }>(
        await http(`${API}/media/upload?${qs({ media_id: String(stage.videoId), command: "STATUS" })}`, { headers: bearer(token) }),
        "Checking X's video processing",
      );
      const p = st.data?.processing_info;
      if (p?.state === "failed") throw new SocialError(`X couldn't process the video: ${clip(p.error?.message ?? "failed")}`);
      if (p && p.state !== "succeeded") return { done: false, stage, retryInSec: Math.max(5, p.check_after_secs ?? 10) };
    }
    mediaIds = [String(stage.videoId)];
  } else {
    const ids: string[] = Array.isArray(stage.imageIds) ? (stage.imageIds as string[]) : [];
    for (let i = ids.length; i < ctx.media.length; i++) {
      ids.push(await uploadImage(ctx, i));
      ctx.stage.imageIds = ids;
    }
    mediaIds = ids;
  }

  const body: Record<string, unknown> = {};
  if (ctx.caption.trim()) body.text = ctx.caption;
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  const r = check<{ data: { id: string } }>(
    await http(`${API}/tweets`, {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "Posting to X",
  );
  const handle = ctx.account.username ?? "i";
  return { done: true, externalId: r.data.id, url: `https://x.com/${handle}/status/${r.data.id}` };
}
