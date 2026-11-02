// apps/api/src/lib/social/providers/linkedin.ts
//
// LinkedIn company Pages through the versioned REST API (Community Management
// API: r_organization_admin + w_organization_social, which LinkedIn must
// approve for the app). One login lists every Page the person administers.
// Access tokens last about 60 days; refresh tokens are only issued to some
// apps, so an expired login shows as "reconnect" on the dashboard.

import { getEnv } from "../../env";
import { clip, expiresIn, form, http, qs } from "./http";
import {
  SocialError,
  transientStatus,
  type ConnectedProfile,
  type PublishContext,
  type RefreshedTokens,
  type SocialProvider,
  type StepResult,
} from "./types";

const REST = "https://api.linkedin.com/rest";
const SCOPES = ["r_organization_admin", "w_organization_social"];

/** The LinkedIn-Version header: the configured month, else three months back (versions live about a year). */
export function linkedinVersion(now = new Date()): string {
  const fixed = getEnv().LINKEDIN_API_VERSION;
  if (fixed) return fixed;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * LinkedIn reads post text as "little text": | { } @ [ ] ( ) < > # \ * _ ~ are
 * syntax, and an unescaped one garbles or truncates the post. Escape them all,
 * then turn #words back into real hashtags.
 */
export function toLittleText(text: string): string {
  const escape = (s: string) => s.replace(/[|{}@[\]()<>#\\*_~]/g, (c) => `\\${c}`);
  // Hashtags first, so an underscore inside one (#CheqPay_NG) stays part of the tag.
  const HASHTAG = /#([\p{L}\p{N}_]+)/gu;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(HASHTAG)) {
    out += escape(text.slice(last, m.index)) + `{hashtag|\\#|${m[1]}}`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escape(text.slice(last));
}

const headers = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  "LinkedIn-Version": linkedinVersion(),
  "X-Restli-Protocol-Version": "2.0.0",
  ...extra,
});

function check<T>(r: { status: number; ok: boolean; json: unknown }, what: string): T {
  if (r.ok) return r.json as T;
  const b = r.json as { message?: string; serviceErrorCode?: number; code?: string };
  const msg = clip(b.message || b.code || `HTTP ${r.status}`);
  throw new SocialError(`${what}: ${msg}`, transientStatus(r.status), r.status === 401);
}

async function tokenRequest(fields: Record<string, string>): Promise<RefreshedTokens> {
  const { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET } = getEnv();
  const r = await http<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error_description?: string;
  }>("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ ...fields, client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET }),
  });
  if (!r.ok || !r.json.access_token) {
    throw new SocialError(`LinkedIn login: ${clip(r.json.error_description || `HTTP ${r.status}`)}`, transientStatus(r.status));
  }
  return {
    accessToken: r.json.access_token,
    refreshToken: r.json.refresh_token ?? null,
    tokenExpiresAt: expiresIn(r.json.expires_in),
    refreshExpiresAt: expiresIn(r.json.refresh_token_expires_in),
  };
}

export const linkedinProvider: SocialProvider = {
  id: "linkedin",
  label: "LinkedIn",
  platforms: ["linkedin"],
  usesPkce: false,
  configured: () => Boolean(getEnv().LINKEDIN_CLIENT_ID && getEnv().LINKEDIN_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri }) {
    return `https://www.linkedin.com/oauth/v2/authorization?${qs({
      response_type: "code",
      client_id: getEnv().LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
    })}`;
  },

  async exchange({ code, redirectUri }) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const acls = check<{ elements?: { organization?: string }[] }>(
      await http(`${REST}/organizationAcls?${qs({ q: "roleAssignee", role: "ADMINISTRATOR", state: "APPROVED" })}`, {
        headers: headers(t.accessToken),
      }),
      "Listing your LinkedIn Pages",
    );
    const out: ConnectedProfile[] = [];
    for (const el of acls.elements ?? []) {
      const urn = el.organization;
      const id = urn?.split(":").pop();
      if (!urn || !id) continue;
      const org = check<{ localizedName?: string; vanityName?: string }>(
        await http(`${REST}/organizations/${id}`, { headers: headers(t.accessToken) }),
        "Reading a LinkedIn Page",
      );
      out.push({
        platform: "linkedin",
        externalId: urn,
        name: org.localizedName ?? `LinkedIn Page ${id}`,
        username: org.vanityName ?? null,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        tokenExpiresAt: t.tokenExpiresAt,
        refreshExpiresAt: t.refreshExpiresAt,
      });
    }
    if (out.length === 0) {
      throw new SocialError("No LinkedIn Pages came back. You need to be an admin of the company Page you want to connect.");
    }
    return out;
  },

  async refresh(account) {
    if (!account.refreshToken) throw new SocialError("LinkedIn login expired. Reconnect the Page.", false, true);
    return tokenRequest({ grant_type: "refresh_token", refresh_token: account.refreshToken });
  },

  publish: publishLinkedIn,
};

async function uploadImage(ctx: PublishContext, idx: number): Promise<string> {
  const token = ctx.account.accessToken;
  const init = check<{ value: { uploadUrl: string; image: string } }>(
    await http(`${REST}/images?action=initializeUpload`, {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner: ctx.account.externalId } }),
    }),
    "Starting the image upload to LinkedIn",
  );
  const put = await http(init.value.uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": ctx.media[idx].mime },
    body: new Uint8Array(await ctx.bytes(ctx.media[idx])),
    timeoutMs: 60_000,
  });
  if (!put.ok) throw new SocialError(`Uploading the image to LinkedIn failed (HTTP ${put.status}).`, transientStatus(put.status));
  return init.value.image;
}

async function publishLinkedIn(ctx: PublishContext): Promise<StepResult> {
  const token = ctx.account.accessToken;
  const owner = ctx.account.externalId;
  const stage = { ...ctx.stage };
  const video = ctx.media.find((m) => m.kind === "video");
  let content: Record<string, unknown> | undefined;

  if (video) {
    if (!stage.videoUrn) {
      const bytes = await ctx.bytes(video);
      const init = check<{
        value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
      }>(
        await http(`${REST}/videos?action=initializeUpload`, {
          method: "POST",
          headers: headers(token, { "content-type": "application/json" }),
          body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
        }),
        "Starting the video upload to LinkedIn",
      );
      const etags: string[] = [];
      for (const part of init.value.uploadInstructions) {
        const put = await http(part.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: new Uint8Array(bytes.subarray(part.firstByte, part.lastByte + 1)),
          timeoutMs: 180_000,
        });
        if (!put.ok) throw new SocialError(`Uploading the video to LinkedIn failed (HTTP ${put.status}).`, transientStatus(put.status));
        etags.push(put.headers.get("etag") ?? "");
      }
      check(
        await http(`${REST}/videos?action=finalizeUpload`, {
          method: "POST",
          headers: headers(token, { "content-type": "application/json" }),
          body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? "", uploadedPartIds: etags } }),
        }),
        "Finishing the video upload to LinkedIn",
      );
      stage.videoUrn = init.value.video;
      ctx.stage.videoUrn = stage.videoUrn;
      return { done: false, stage, retryInSec: 20 };
    }
    const st = check<{ status?: string }>(
      await http(`${REST}/videos/${encodeURIComponent(String(stage.videoUrn))}`, { headers: headers(token) }),
      "Checking LinkedIn's video processing",
    );
    if (st.status === "PROCESSING_FAILED") throw new SocialError("LinkedIn couldn't process the video.");
    if (st.status !== "AVAILABLE") return { done: false, stage, retryInSec: 20 };
    content = { media: { id: stage.videoUrn } };
  } else if (ctx.media.length > 0) {
    const urns: string[] = Array.isArray(stage.imageUrns) ? (stage.imageUrns as string[]) : [];
    for (let i = urns.length; i < ctx.media.length; i++) {
      urns.push(await uploadImage(ctx, i));
      ctx.stage.imageUrns = urns;
    }
    content = urns.length === 1 ? { media: { id: urns[0] } } : { multiImage: { images: urns.map((id) => ({ id })) } };
  }

  const r = await http(`${REST}/posts`, {
    method: "POST",
    headers: headers(token, { "content-type": "application/json" }),
    body: JSON.stringify({
      author: owner,
      commentary: toLittleText(ctx.caption),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(content ? { content } : {}),
    }),
  });
  check(r, "Posting to LinkedIn");
  const urn = r.headers.get("x-restli-id") ?? r.headers.get("x-linkedin-id") ?? "";
  return { done: true, externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : null };
}
