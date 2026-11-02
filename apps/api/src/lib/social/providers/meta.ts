// apps/api/src/lib/social/providers/meta.ts
//
// Facebook Pages and Instagram professional accounts, through one Meta app and
// the Graph API. One Facebook login yields every Page the person manages, plus
// the Instagram account linked to each Page. Page tokens obtained from a
// long-lived user token do not expire, so nothing needs refreshing.
//
// Required Meta permissions (App Review): pages_show_list, pages_read_engagement,
// pages_manage_posts, instagram_basic, instagram_content_publish,
// business_management.

import { getEnv } from "../../env";
import type { Platform } from "../rules";
import { clip, form, http, qs } from "./http";
import {
  SocialError,
  transientStatus,
  type ConnectedProfile,
  type PublishContext,
  type SocialProvider,
  type StepResult,
} from "./types";

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

const graph = () => `https://graph.facebook.com/${getEnv().META_GRAPH_VERSION}`;

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; error_user_msg?: string };
}

/** Throw a SocialError for a Graph error response; return the body otherwise. */
function check<T>(r: { status: number; ok: boolean; json: unknown }, what: string): T {
  const e = (r.json as GraphError).error;
  if (r.ok && !e) return r.json as T;
  const code = e?.code;
  const msg = clip(e?.error_user_msg || e?.message || `HTTP ${r.status}`);
  // 190: token invalid/expired. 10/200-299: permission missing (needs reconnect with the permission).
  const reconnect = code === 190 || code === 102 || (code !== undefined && code >= 200 && code < 300) || code === 10;
  const retryable = !reconnect && (transientStatus(r.status) || e?.is_transient === true || code === 4 || code === 17 || code === 32 || code === 613 || code === 2);
  throw new SocialError(`${what}: ${msg}`, retryable, reconnect);
}

async function gget<T>(path: string, params: Record<string, string | number | undefined>, what: string): Promise<T> {
  return check<T>(await http(`${graph()}${path}?${qs(params)}`), what);
}

async function gpost<T>(path: string, fields: Record<string, string | number | boolean | undefined>, what: string, timeoutMs?: number): Promise<T> {
  return check<T>(await http(`${graph()}${path}`, { method: "POST", body: form(fields), timeoutMs }), what);
}

interface PageRow {
  id: string;
  name: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

export const metaProvider: SocialProvider = {
  id: "meta",
  label: "Facebook & Instagram",
  platforms: ["facebook", "instagram"],
  usesPkce: false,
  configured: () => Boolean(getEnv().META_APP_ID && getEnv().META_APP_SECRET),

  authorizeUrl({ state, redirectUri }) {
    const { META_APP_ID, META_GRAPH_VERSION } = getEnv();
    return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${qs({
      client_id: META_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(","),
      response_type: "code",
    })}`;
  },

  async exchange({ code, redirectUri }) {
    const { META_APP_ID, META_APP_SECRET } = getEnv();
    const short = await gget<{ access_token: string }>(
      "/oauth/access_token",
      { client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: redirectUri, code },
      "Facebook login",
    );
    const long = await gget<{ access_token: string }>(
      "/oauth/access_token",
      { grant_type: "fb_exchange_token", client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: short.access_token },
      "Facebook login",
    );
    const pages = await gget<{ data: PageRow[] }>(
      "/me/accounts",
      {
        fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
        limit: 100,
        access_token: long.access_token,
      },
      "Listing your Facebook Pages",
    );
    const out: ConnectedProfile[] = [];
    for (const p of pages.data ?? []) {
      if (!p.access_token) continue;
      out.push({
        platform: "facebook",
        externalId: p.id,
        name: p.name,
        avatarUrl: p.picture?.data?.url ?? null,
        accessToken: p.access_token,
        tokenExpiresAt: null,
      });
      const ig = p.instagram_business_account;
      if (ig) {
        out.push({
          platform: "instagram",
          externalId: ig.id,
          name: ig.name || ig.username || p.name,
          username: ig.username ?? null,
          avatarUrl: ig.profile_picture_url ?? null,
          accessToken: p.access_token,
          tokenExpiresAt: null,
          meta: { pageId: p.id },
        });
      }
    }
    if (out.length === 0) {
      throw new SocialError(
        "No Facebook Pages came back. Make sure you manage at least one Page and ticked it when Facebook asked which Pages to allow.",
      );
    }
    return out;
  },

  publish(ctx) {
    return ctx.account.platform === "instagram" ? publishInstagram(ctx) : publishFacebook(ctx);
  },
};

async function publishFacebook(ctx: PublishContext): Promise<StepResult> {
  const page = ctx.account.externalId;
  const token = ctx.account.accessToken;
  const video = ctx.media.find((m) => m.kind === "video");
  const images = ctx.media.filter((m) => m.kind === "image");

  if (video) {
    const r = await gpost<{ id: string }>(
      `/${page}/videos`,
      { file_url: await ctx.signedUrl(video), description: ctx.caption, access_token: token },
      "Posting the video to Facebook",
      120_000,
    );
    return { done: true, externalId: r.id, url: `https://www.facebook.com/${r.id}` };
  }
  if (images.length === 1) {
    const r = await gpost<{ id: string; post_id?: string }>(
      `/${page}/photos`,
      { url: await ctx.signedUrl(images[0]), message: ctx.caption, access_token: token },
      "Posting the photo to Facebook",
      60_000,
    );
    const id = r.post_id ?? r.id;
    return { done: true, externalId: id, url: `https://www.facebook.com/${id}` };
  }
  const fields: Record<string, string> = { message: ctx.caption, access_token: token };
  if (images.length > 1) {
    // Upload each photo unpublished, then one feed post that attaches them all.
    const ids: string[] = Array.isArray(ctx.stage.photoIds) ? (ctx.stage.photoIds as string[]) : [];
    for (let i = ids.length; i < images.length; i++) {
      const r = await gpost<{ id: string }>(
        `/${page}/photos`,
        { url: await ctx.signedUrl(images[i]), published: false, access_token: token },
        "Uploading a photo to Facebook",
        60_000,
      );
      ids.push(r.id);
      ctx.stage.photoIds = ids; // kept if a later photo fails, so a retry doesn't re-upload
    }
    ids.forEach((id, i) => (fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  }
  const r = await gpost<{ id: string }>(`/${page}/feed`, fields, "Posting to Facebook");
  return { done: true, externalId: r.id, url: `https://www.facebook.com/${r.id}` };
}

async function publishInstagram(ctx: PublishContext): Promise<StepResult> {
  const ig = ctx.account.externalId;
  const token = ctx.account.accessToken;
  const stage = { ...ctx.stage };
  const video = ctx.media.find((m) => m.kind === "video");
  const images = ctx.media.filter((m) => m.kind === "image");

  // 1. Create the container (once).
  if (!stage.containerId) {
    if (video) {
      const r = await gpost<{ id: string }>(
        `/${ig}/media`,
        { media_type: "REELS", video_url: await ctx.signedUrl(video), caption: ctx.caption, share_to_feed: true, access_token: token },
        "Sending the video to Instagram",
      );
      stage.containerId = r.id;
    } else if (images.length === 1) {
      const r = await gpost<{ id: string }>(
        `/${ig}/media`,
        { image_url: await ctx.signedUrl(images[0]), caption: ctx.caption, access_token: token },
        "Sending the photo to Instagram",
      );
      stage.containerId = r.id;
    } else {
      const children: string[] = Array.isArray(stage.children) ? (stage.children as string[]) : [];
      for (let i = children.length; i < images.length; i++) {
        const r = await gpost<{ id: string }>(
          `/${ig}/media`,
          { image_url: await ctx.signedUrl(images[i]), is_carousel_item: true, access_token: token },
          "Sending a carousel photo to Instagram",
        );
        children.push(r.id);
        stage.children = children;
        ctx.stage.children = children;
      }
      const r = await gpost<{ id: string }>(
        `/${ig}/media`,
        { media_type: "CAROUSEL", children: children.join(","), caption: ctx.caption, access_token: token },
        "Building the Instagram carousel",
      );
      stage.containerId = r.id;
    }
    ctx.stage.containerId = stage.containerId;
  }

  // 2. Wait until Instagram has processed it (videos take a while).
  const st = await gget<{ status_code?: string; status?: string }>(
    `/${stage.containerId}`,
    { fields: "status_code,status", access_token: token },
    "Checking Instagram's processing",
  );
  if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
    throw new SocialError(`Instagram couldn't process the media: ${clip(st.status ?? st.status_code)}`);
  }
  if (st.status_code !== "FINISHED" && st.status_code !== "PUBLISHED") {
    return { done: false, stage, retryInSec: video ? 30 : 10 };
  }

  // 3. Publish. A container can only be published once, so a retry after a lost
  // response fails loudly rather than posting twice.
  const pub = await gpost<{ id: string }>(
    `/${ig}/media_publish`,
    { creation_id: String(stage.containerId), access_token: token },
    "Publishing on Instagram",
  );
  let url: string | null = null;
  try {
    url = (await gget<{ permalink?: string }>(`/${pub.id}`, { fields: "permalink", access_token: token }, "Instagram link")).permalink ?? null;
  } catch {
    // The post is live; a missing link isn't worth failing it.
  }
  return { done: true, externalId: pub.id, url };
}

export const META_PLATFORMS: Platform[] = ["facebook", "instagram"];
