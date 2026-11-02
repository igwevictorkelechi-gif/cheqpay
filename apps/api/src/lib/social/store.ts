// apps/api/src/lib/social/store.ts
//
// Reads and writes for the social scheduler. Tokens are decrypted only in
// loadAccountForPublish and are never part of anything returned to the
// dashboard.

import { randomUUID } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { decryptPii, encryptPii } from "../pii";
import type { AccountForPublish, ConnectedProfile, MediaForPublish, RefreshedTokens } from "./providers/types";
import {
  MEDIA_LIMITS,
  isPlatform,
  validatePost,
  type MediaKind,
  type Platform,
  type PostStatus,
  type TargetStatus,
} from "./rules";
import { ensureSocialSchema } from "./schema";
import { objectInfo, signedDownloadUrl, signedUploadUrl } from "./storage";

// ---- Accounts ---------------------------------------------------------------------

export interface AccountView {
  id: string;
  platform: Platform;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: "active" | "needs_reconnect" | "disconnected";
  lastError: string | null;
  tokenExpiresAt: string | null;
  connectedBy: string;
  createdAt: string;
}

interface AccountRow {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  meta: Record<string, unknown> | null;
  status: AccountView["status"];
  last_error: string | null;
  connected_by: string;
  created_at: Date;
}

const toAccountView = (r: AccountRow): AccountView => ({
  id: r.id,
  platform: r.platform as Platform,
  name: r.name,
  username: r.username,
  avatarUrl: r.avatar_url,
  status: r.status,
  lastError: r.last_error,
  tokenExpiresAt: r.token_expires_at?.toISOString() ?? null,
  connectedBy: r.connected_by,
  createdAt: r.created_at.toISOString(),
});

export async function saveConnectedProfiles(profiles: ConnectedProfile[], actor: string): Promise<number> {
  await ensureSocialSchema();
  for (const p of profiles) {
    if (!p.externalId) continue;
    await prisma.$executeRaw`
      INSERT INTO social_accounts
        (platform, external_id, name, username, avatar_url, access_token_enc, refresh_token_enc,
         token_expires_at, refresh_expires_at, meta, status, last_error, connected_by)
      VALUES (${p.platform}, ${p.externalId}, ${p.name}, ${p.username ?? null}, ${p.avatarUrl ?? null},
              ${encryptPii(p.accessToken)}, ${p.refreshToken ? encryptPii(p.refreshToken) : null},
              ${p.tokenExpiresAt ?? null}, ${p.refreshExpiresAt ?? null}, ${JSON.stringify(p.meta ?? {})}::jsonb,
              'active', NULL, ${actor})
      ON CONFLICT (platform, external_id) DO UPDATE SET
        name = EXCLUDED.name, username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url,
        access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
        token_expires_at = EXCLUDED.token_expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at,
        meta = EXCLUDED.meta, status = 'active', last_error = NULL,
        connected_by = EXCLUDED.connected_by, updated_at = now()`;
  }
  return profiles.length;
}

export async function listAccounts(includeDisconnected = false): Promise<AccountView[]> {
  await ensureSocialSchema();
  const rows = await prisma.$queryRaw<AccountRow[]>`
    SELECT * FROM social_accounts
    WHERE ${includeDisconnected} OR status <> 'disconnected'
    ORDER BY platform, name`;
  return rows.map(toAccountView);
}

export async function disconnectAccount(id: string): Promise<AccountView> {
  await ensureSocialSchema();
  const rows = await prisma.$queryRaw<AccountRow[]>`
    UPDATE social_accounts
    SET status = 'disconnected', access_token_enc = '', refresh_token_enc = NULL, updated_at = now()
    WHERE id = ${id}::uuid RETURNING *`;
  if (!rows[0]) throw new ApiError(404, "Account not found.", "not_found");
  // Anything still waiting to go to this account won't.
  await prisma.$executeRaw`
    UPDATE social_post_targets SET status = 'cancelled', error = 'Account disconnected', updated_at = now()
    WHERE account_id = ${id}::uuid AND status IN ('queued', 'processing')`;
  return toAccountView(rows[0]);
}

export async function loadAccountForPublish(id: string): Promise<AccountForPublish | null> {
  const rows = await prisma.$queryRaw<AccountRow[]>`SELECT * FROM social_accounts WHERE id = ${id}::uuid`;
  const r = rows[0];
  if (!r || r.status === "disconnected" || !r.access_token_enc) return null;
  return {
    id: r.id,
    platform: r.platform as Platform,
    externalId: r.external_id,
    name: r.name,
    username: r.username,
    accessToken: decryptPii(r.access_token_enc),
    refreshToken: r.refresh_token_enc ? decryptPii(r.refresh_token_enc) : null,
    tokenExpiresAt: r.token_expires_at,
    meta: r.meta ?? {},
  };
}

export async function saveRefreshedTokens(id: string, t: RefreshedTokens): Promise<void> {
  await prisma.$executeRaw`
    UPDATE social_accounts SET
      access_token_enc = ${encryptPii(t.accessToken)},
      refresh_token_enc = COALESCE(${t.refreshToken ? encryptPii(t.refreshToken) : null}, refresh_token_enc),
      token_expires_at = ${t.tokenExpiresAt ?? null},
      refresh_expires_at = COALESCE(${t.refreshExpiresAt ?? null}, refresh_expires_at),
      status = 'active', last_error = NULL, updated_at = now()
    WHERE id = ${id}::uuid`;
}

export async function markNeedsReconnect(id: string, message: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE social_accounts SET status = 'needs_reconnect', last_error = ${message.slice(0, 500)}, updated_at = now()
    WHERE id = ${id}::uuid AND status <> 'disconnected'`;
}

// ---- Media ------------------------------------------------------------------------

export interface MediaView {
  id: string;
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: "pending" | "ready";
}

interface MediaRow {
  id: string;
  storage_path: string;
  kind: MediaKind;
  mime: string;
  size_bytes: bigint | number;
  width: number | null;
  height: number | null;
  status: "pending" | "ready";
}

const toMediaView = (r: MediaRow): MediaView => ({
  id: r.id,
  kind: r.kind,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  width: r.width,
  height: r.height,
  status: r.status,
});

export async function createMedia(input: {
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  actor: string;
}): Promise<{ media: MediaView; uploadUrl: string }> {
  const limits = MEDIA_LIMITS[input.kind];
  if (!(limits.mimes as readonly string[]).includes(input.mime)) {
    throw new ApiError(422, input.kind === "image" ? "Images must be JPEG." : "Videos must be MP4.", "bad_media_type");
  }
  if (!(input.sizeBytes > 0) || input.sizeBytes > limits.maxBytes) {
    throw new ApiError(422, `That file is too big: the limit is ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`, "media_too_big");
  }
  await ensureSocialSchema();
  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${input.kind === "image" ? "jpg" : "mp4"}`;
  const uploadUrl = await signedUploadUrl(path);
  const rows = await prisma.$queryRaw<MediaRow[]>`
    INSERT INTO social_media (storage_path, kind, mime, size_bytes, width, height, uploaded_by)
    VALUES (${path}, ${input.kind}, ${input.mime}, ${input.sizeBytes}, ${input.width ?? null}, ${input.height ?? null}, ${input.actor})
    RETURNING *`;
  return { media: toMediaView(rows[0]), uploadUrl };
}

/** Confirm the browser's upload landed and matches what was declared. */
export async function completeMedia(id: string): Promise<MediaView> {
  await ensureSocialSchema();
  const rows = await prisma.$queryRaw<MediaRow[]>`SELECT * FROM social_media WHERE id = ${id}::uuid`;
  const m = rows[0];
  if (!m) throw new ApiError(404, "Media not found.", "not_found");
  if (m.status === "ready") return toMediaView(m);
  const info = await objectInfo(m.storage_path);
  if (!info) throw new ApiError(409, "The upload hasn't arrived yet. Try again.", "upload_missing");
  if (info.size > MEDIA_LIMITS[m.kind].maxBytes) throw new ApiError(422, "That file is larger than allowed.", "media_too_big");
  const done = await prisma.$queryRaw<MediaRow[]>`
    UPDATE social_media SET status = 'ready', size_bytes = ${info.size || Number(m.size_bytes)}
    WHERE id = ${id}::uuid RETURNING *`;
  return toMediaView(done[0]);
}

export async function mediaPreviewUrl(id: string): Promise<string> {
  const rows = await prisma.$queryRaw<MediaRow[]>`SELECT * FROM social_media WHERE id = ${id}::uuid AND status = 'ready'`;
  if (!rows[0]) throw new ApiError(404, "Media not found.", "not_found");
  return signedDownloadUrl(rows[0].storage_path, 3600);
}

/** Media rows in the given order, ready ones only. */
export async function mediaForPublish(ids: string[]): Promise<MediaForPublish[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<MediaRow[]>`
    SELECT * FROM social_media WHERE id = ANY(${ids}::uuid[]) AND status = 'ready'`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is MediaRow => Boolean(r))
    .map((r) => ({ id: r.id, kind: r.kind, mime: r.mime, size: Number(r.size_bytes), storagePath: r.storage_path }));
}

export async function mediaById(id: string): Promise<MediaForPublish | null> {
  return (await mediaForPublish([id]))[0] ?? null;
}

// ---- Posts --------------------------------------------------------------------------

export interface TargetView {
  id: string;
  accountId: string;
  platform: Platform;
  accountName: string;
  status: TargetStatus;
  attempts: number;
  externalUrl: string | null;
  error: string | null;
  publishedAt: string | null;
}

export interface PostView {
  id: string;
  caption: string;
  overrides: Partial<Record<Platform, string>>;
  media: MediaView[];
  status: PostStatus;
  scheduledAt: string | null;
  reviewNote: string | null;
  createdBy: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: TargetView[];
}

interface PostRow {
  id: string;
  caption: string;
  overrides: Record<string, string> | null;
  media_ids: string[];
  status: PostStatus;
  scheduled_at: Date | null;
  review_note: string | null;
  created_by: string;
  submitted_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface TargetJoinRow {
  id: string;
  post_id: string;
  account_id: string;
  platform: string;
  account_name: string;
  status: TargetStatus;
  attempts: number;
  external_url: string | null;
  error: string | null;
  published_at: Date | null;
}

async function hydrate(posts: PostRow[]): Promise<PostView[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const mediaIds = [...new Set(posts.flatMap((p) => p.media_ids))];
  const [targets, media] = await Promise.all([
    prisma.$queryRaw<TargetJoinRow[]>`
      SELECT t.id, t.post_id, t.account_id, a.platform, a.name AS account_name, t.status, t.attempts,
             t.external_url, t.error, t.published_at
      FROM social_post_targets t JOIN social_accounts a ON a.id = t.account_id
      WHERE t.post_id = ANY(${ids}::uuid[])
      ORDER BY a.platform, a.name`,
    mediaIds.length
      ? prisma.$queryRaw<MediaRow[]>`SELECT * FROM social_media WHERE id = ANY(${mediaIds}::uuid[])`
      : Promise.resolve([] as MediaRow[]),
  ]);
  const mediaById = new Map(media.map((m) => [m.id, toMediaView(m)]));
  return posts.map((p) => ({
    id: p.id,
    caption: p.caption,
    overrides: (p.overrides ?? {}) as PostView["overrides"],
    media: p.media_ids.map((id) => mediaById.get(id)).filter((m): m is MediaView => Boolean(m)),
    status: p.status,
    scheduledAt: p.scheduled_at?.toISOString() ?? null,
    reviewNote: p.review_note,
    createdBy: p.created_by,
    submittedAt: p.submitted_at?.toISOString() ?? null,
    approvedBy: p.approved_by,
    approvedAt: p.approved_at?.toISOString() ?? null,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    targets: targets
      .filter((t) => t.post_id === p.id)
      .map((t) => ({
        id: t.id,
        accountId: t.account_id,
        platform: t.platform as Platform,
        accountName: t.account_name,
        status: t.status,
        attempts: t.attempts,
        externalUrl: t.external_url,
        error: t.error,
        publishedAt: t.published_at?.toISOString() ?? null,
      })),
  }));
}

export async function listPosts(opts: { from?: Date; to?: Date; status?: PostStatus } = {}): Promise<PostView[]> {
  await ensureSocialSchema();
  const from = opts.from ?? new Date(Date.now() - 60 * 86400_000);
  const to = opts.to ?? new Date(Date.now() + 365 * 86400_000);
  const rows = await prisma.$queryRaw<PostRow[]>`
    SELECT * FROM social_posts
    WHERE (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
      AND COALESCE(scheduled_at, created_at) BETWEEN ${from} AND ${to}
    ORDER BY COALESCE(scheduled_at, created_at) DESC
    LIMIT 300`;
  return hydrate(rows);
}

export async function getPost(id: string): Promise<PostView> {
  await ensureSocialSchema();
  const rows = await prisma.$queryRaw<PostRow[]>`SELECT * FROM social_posts WHERE id = ${id}::uuid`;
  if (!rows[0]) throw new ApiError(404, "Post not found.", "not_found");
  return (await hydrate(rows))[0];
}

export interface PostInput {
  caption: string;
  overrides: Partial<Record<Platform, string>>;
  mediaIds: string[];
  accountIds: string[];
  scheduledAt: Date | null;
}

/** The accounts and media a post refers to must exist and be usable. */
async function checkRefs(input: PostInput): Promise<{ platforms: Platform[]; kinds: MediaKind[] }> {
  const accounts = input.accountIds.length
    ? await prisma.$queryRaw<{ id: string; platform: string; status: string }[]>`
        SELECT id, platform, status FROM social_accounts WHERE id = ANY(${input.accountIds}::uuid[])`
    : [];
  if (accounts.length !== new Set(input.accountIds).size) throw new ApiError(422, "One of the chosen accounts no longer exists.", "bad_account");
  const disconnected = accounts.find((a) => a.status === "disconnected");
  if (disconnected) throw new ApiError(422, "One of the chosen accounts is disconnected.", "bad_account");
  const media = await mediaForPublish(input.mediaIds);
  if (media.length !== input.mediaIds.length) throw new ApiError(422, "An image or video hasn't finished uploading.", "media_not_ready");
  return { platforms: accounts.map((a) => a.platform).filter(isPlatform), kinds: media.map((m) => m.kind) };
}

/** Throw with every problem, per platform, if the post can't go out as it is. */
export async function assertPublishable(input: PostInput): Promise<void> {
  if (input.accountIds.length === 0) throw new ApiError(422, "Choose at least one account to post to.", "no_accounts");
  const { platforms, kinds } = await checkRefs(input);
  const problems = validatePost({ caption: input.caption, overrides: input.overrides, media: kinds.map((kind) => ({ kind })) }, platforms);
  const all = Object.values(problems).flat();
  if (all.length) throw new ApiError(422, all.join(" "), "post_invalid");
}

async function replaceTargets(postId: string, accountIds: string[]): Promise<void> {
  await prisma.$executeRaw`DELETE FROM social_post_targets WHERE post_id = ${postId}::uuid`;
  for (const accountId of new Set(accountIds)) {
    await prisma.$executeRaw`
      INSERT INTO social_post_targets (post_id, account_id) VALUES (${postId}::uuid, ${accountId}::uuid)`;
  }
}

export async function createPost(input: PostInput, actor: string): Promise<PostView> {
  await ensureSocialSchema();
  await checkRefs(input);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO social_posts (caption, overrides, media_ids, scheduled_at, created_by)
    VALUES (${input.caption}, ${JSON.stringify(input.overrides)}::jsonb, ${input.mediaIds}::uuid[], ${input.scheduledAt}, ${actor})
    RETURNING id`;
  await replaceTargets(rows[0].id, input.accountIds);
  return getPost(rows[0].id);
}

const EDITABLE: PostStatus[] = ["draft", "pending_approval", "scheduled"];

export async function updatePost(id: string, input: PostInput): Promise<PostView> {
  const post = await getPost(id);
  if (!EDITABLE.includes(post.status)) throw new ApiError(409, "Only drafts and posts that haven't gone out yet can be edited.", "not_editable");
  await checkRefs(input);
  // Any edit sends the post back to draft: what was approved is no longer what will go out.
  await prisma.$executeRaw`
    UPDATE social_posts SET caption = ${input.caption}, overrides = ${JSON.stringify(input.overrides)}::jsonb,
      media_ids = ${input.mediaIds}::uuid[], scheduled_at = ${input.scheduledAt}, status = 'draft',
      approved_by = NULL, approved_at = NULL, submitted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid`;
  await replaceTargets(id, input.accountIds);
  return getPost(id);
}

function inputOf(p: PostView): PostInput {
  return {
    caption: p.caption,
    overrides: p.overrides,
    mediaIds: p.media.map((m) => m.id),
    accountIds: p.targets.map((t) => t.accountId),
    scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
  };
}

/** A status change guarded on the status we read: first writer wins, a stale click gets a clear error. */
async function guarded(update: Promise<number>, expected: string): Promise<void> {
  if ((await update) !== 1) throw new ApiError(409, `This post is no longer ${expected}. Refresh and try again.`, "stale_status");
}

export async function submitPost(id: string): Promise<PostView> {
  const post = await getPost(id);
  if (post.status !== "draft") throw new ApiError(409, "Only a draft can be sent for approval.", "bad_status");
  await assertPublishable(inputOf(post));
  await guarded(prisma.$executeRaw`
    UPDATE social_posts SET status = 'pending_approval', submitted_at = now(), review_note = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'draft'`, "a draft");
  return getPost(id);
}

/**
 * Approve: a Super Admin may approve anything, including straight from draft;
 * anyone else needs it submitted and may not approve their own post. A post
 * due within a minute (or with no time) goes out now; otherwise it waits.
 */
export async function approvePost(id: string, actor: { email: string; role: "admin" | "super" }): Promise<PostView> {
  const post = await getPost(id);
  const allowed: PostStatus[] = actor.role === "super" ? ["draft", "pending_approval"] : ["pending_approval"];
  if (!allowed.includes(post.status)) throw new ApiError(409, "This post isn't waiting for approval.", "bad_status");
  if (actor.role !== "super" && post.createdBy === actor.email) {
    throw new ApiError(403, "Someone else needs to approve your post (or a Super Admin).", "self_approval");
  }
  await assertPublishable(inputOf(post));
  const now = Date.now();
  const due = !post.scheduledAt || new Date(post.scheduledAt).getTime() <= now + 60_000;
  const next: PostStatus = due ? "publishing" : "scheduled";
  await guarded(prisma.$executeRaw`
    UPDATE social_posts SET status = ${next}, approved_by = ${actor.email}, approved_at = now(),
      scheduled_at = COALESCE(scheduled_at, now()), updated_at = now()
    WHERE id = ${id}::uuid AND status = ANY(${allowed}::text[])`, "waiting for approval");
  await prisma.$executeRaw`
    UPDATE social_post_targets SET status = 'queued', attempts = 0, next_attempt_at = NULL, error = NULL,
      stage = '{}'::jsonb, updated_at = now()
    WHERE post_id = ${id}::uuid AND status <> 'cancelled'`;
  return getPost(id);
}

export async function rejectPost(id: string, note: string): Promise<PostView> {
  await guarded(prisma.$executeRaw`
    UPDATE social_posts SET status = 'draft', review_note = ${note.slice(0, 1000)}, submitted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'pending_approval'`, "waiting for approval");
  return getPost(id);
}

export async function unschedulePost(id: string): Promise<PostView> {
  await guarded(prisma.$executeRaw`
    UPDATE social_posts SET status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'scheduled'`, "scheduled");
  return getPost(id);
}

/** Send the failed accounts of a post again. */
export async function retryPost(id: string): Promise<PostView> {
  const post = await getPost(id);
  if (post.status !== "failed" && post.status !== "partially_failed") throw new ApiError(409, "Only failed posts can be retried.", "bad_status");
  await prisma.$executeRaw`
    UPDATE social_post_targets SET status = 'queued', attempts = 0, next_attempt_at = NULL, error = NULL, updated_at = now()
    WHERE post_id = ${id}::uuid AND status = 'failed'`;
  await prisma.$executeRaw`UPDATE social_posts SET status = 'publishing', updated_at = now() WHERE id = ${id}::uuid`;
  return getPost(id);
}

export async function deletePost(id: string): Promise<void> {
  const post = await getPost(id);
  if (post.status === "publishing") throw new ApiError(409, "This post is going out right now; wait for it to finish.", "publishing");
  await prisma.$executeRaw`DELETE FROM social_posts WHERE id = ${id}::uuid`;
}
