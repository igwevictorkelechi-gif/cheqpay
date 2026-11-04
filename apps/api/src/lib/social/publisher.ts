// apps/api/src/lib/social/publisher.ts
//
// Sends approved posts. Run every minute (and immediately on "publish now"):
//
//   1. scheduled posts whose time has come become "publishing";
//   2. targets (one post × one account) are CLAIMED one at a time with
//      FOR UPDATE SKIP LOCKED plus a lease, so two overlapping runs never send
//      the same target;
//   3. each claimed target is advanced one step by its platform's provider.
//      Providers record progress (upload ids, containers) in the target's
//      stage, which is saved even when a step throws, so a retry resumes rather
//      than re-uploading; platforms still processing a video say "check back in
//      N seconds" and the target simply waits;
//   4. failures are retried with backoff when the platform says try again,
//      flag the account for reconnecting when the login is no longer valid, and
//      otherwise fail with the platform's message;
//   5. once every target of a post has finished, the post is marked
//      published / partially failed / failed, and the team is told of failures.

import { prisma } from "@cheqpay/db";
import { notifyAdmins } from "../adminNotify";
import { mediaProxyUrl } from "./mediaProxy";
import { providerFor } from "./providers";
import { SocialError, type MediaForPublish, type PublishContext } from "./providers/types";
import {
  MAX_ATTEMPTS,
  PLATFORM_LABEL,
  effectiveCaption,
  retryDelaySeconds,
  settledPostStatus,
  type Platform,
  type TargetStatus,
} from "./rules";
import { ensureSocialSchema } from "./schema";
import { downloadObject, signedDownloadUrl } from "./storage";
import { loadAccountForPublish, markNeedsReconnect, mediaForPublish, saveRefreshedTokens } from "./store";

const LEASE_MIN = 5;
/** Refresh a token that expires within this window before using it. */
const REFRESH_WINDOW_MS = 5 * 60_000;
const MAX_PROCESSING_MS = 2 * 3600_000;

interface ClaimedTarget {
  id: string;
  post_id: string;
  account_id: string;
  status: TargetStatus;
  stage: Record<string, unknown> | null;
  attempts: number;
}

export interface PublishRunSummary {
  promoted: number;
  processed: number;
  published: number;
  waiting: number;
  retrying: number;
  failed: number;
}

export async function runPublisher(opts: { budgetMs?: number; postId?: string } = {}): Promise<PublishRunSummary> {
  await ensureSocialSchema();
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  const summary: PublishRunSummary = { promoted: 0, processed: 0, published: 0, waiting: 0, retrying: 0, failed: 0 };

  summary.promoted = await prisma.$executeRaw`
    UPDATE social_posts SET status = 'publishing', updated_at = now()
    WHERE status = 'scheduled' AND scheduled_at <= now()`;

  const touched = new Set<string>();
  while (Date.now() < deadline) {
    const target = await claimNext(opts.postId);
    if (!target) break;
    summary.processed++;
    touched.add(target.post_id);
    const outcome = await processTarget(target);
    summary[outcome]++;
  }
  for (const postId of touched) await settlePost(postId);
  return summary;
}

async function claimNext(postId?: string): Promise<ClaimedTarget | null> {
  const rows = await prisma.$queryRaw<ClaimedTarget[]>`
    UPDATE social_post_targets t
    SET locked_until = now() + make_interval(mins => ${LEASE_MIN}), updated_at = now()
    WHERE t.id = (
      SELECT t2.id FROM social_post_targets t2
      JOIN social_posts p ON p.id = t2.post_id
      WHERE p.status = 'publishing'
        AND (${postId ?? null}::uuid IS NULL OR p.id = ${postId ?? null}::uuid)
        AND t2.status IN ('queued', 'processing')
        AND (t2.next_attempt_at IS NULL OR t2.next_attempt_at <= now())
        AND (t2.locked_until IS NULL OR t2.locked_until < now())
      ORDER BY p.scheduled_at NULLS FIRST, t2.created_at
      LIMIT 1
      FOR UPDATE OF t2 SKIP LOCKED
    )
    RETURNING t.id, t.post_id, t.account_id, t.status, t.stage, t.attempts`;
  return rows[0] ?? null;
}

type Outcome = "published" | "waiting" | "retrying" | "failed";

async function processTarget(t: ClaimedTarget): Promise<Outcome> {
  const stage: Record<string, unknown> = { ...(t.stage ?? {}) };
  const account = await loadAccountForPublish(t.account_id);
  if (!account) return fail(t, stage, "The account was disconnected.");

  const posts = await prisma.$queryRaw<{ caption: string; overrides: Record<string, string> | null; media_ids: string[] }[]>`
    SELECT caption, overrides, media_ids FROM social_posts WHERE id = ${t.post_id}::uuid`;
  const post = posts[0];
  if (!post) return fail(t, stage, "The post was deleted.");

  // A platform that never finishes processing must not keep a post "publishing" forever.
  stage.startedAt ??= new Date().toISOString();
  if (Date.now() - new Date(String(stage.startedAt)).getTime() > MAX_PROCESSING_MS) {
    return fail(t, stage, "The platform didn't finish processing within 2 hours.");
  }

  const provider = providerFor(account.platform);
  try {
    if (provider.refresh && account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + REFRESH_WINDOW_MS) {
      const fresh = await provider.refresh(account);
      await saveRefreshedTokens(account.id, fresh);
      account.accessToken = fresh.accessToken;
      account.refreshToken = fresh.refreshToken ?? account.refreshToken;
      account.tokenExpiresAt = fresh.tokenExpiresAt ?? null;
    }

    const media = await mediaForPublish(post.media_ids);
    const cache = new Map<string, Promise<Buffer>>();
    const ctx: PublishContext = {
      account,
      caption: effectiveCaption(account.platform, { caption: post.caption, overrides: post.overrides ?? {} }),
      media,
      stage,
      signedUrl: (m: MediaForPublish) => signedDownloadUrl(m.storagePath, 3600),
      proxiedUrl: (m: MediaForPublish) => mediaProxyUrl(m.id),
      bytes: (m: MediaForPublish) => {
        if (!cache.has(m.id)) cache.set(m.id, downloadObject(m.storagePath));
        return cache.get(m.id)!;
      },
    };

    const result = await provider.publish(ctx);
    if (result.done) {
      await prisma.$executeRaw`
        UPDATE social_post_targets SET status = 'published', external_id = ${result.externalId},
          external_url = ${result.url}, published_at = now(), error = NULL, locked_until = NULL,
          stage = ${JSON.stringify(stage)}::jsonb, updated_at = now()
        WHERE id = ${t.id}::uuid`;
      return "published";
    }
    const merged = { ...stage, ...result.stage };
    await prisma.$executeRaw`
      UPDATE social_post_targets SET status = 'processing', stage = ${JSON.stringify(merged)}::jsonb,
        next_attempt_at = now() + make_interval(secs => ${result.retryInSec}), locked_until = NULL, updated_at = now()
      WHERE id = ${t.id}::uuid`;
    return "waiting";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SocialError && err.reconnect) {
      await markNeedsReconnect(account.id, message);
      return fail(t, stage, `${message} Reconnect ${account.name} on the Accounts page, then retry.`);
    }
    // Platform hiccups — and our own storage or network errors — get retried.
    const retryable = err instanceof SocialError ? err.retryable : true;
    const attempts = t.attempts + 1;
    if (retryable && attempts < MAX_ATTEMPTS) {
      await prisma.$executeRaw`
        UPDATE social_post_targets SET attempts = ${attempts}, error = ${message.slice(0, 1000)},
          stage = ${JSON.stringify(stage)}::jsonb, locked_until = NULL,
          next_attempt_at = now() + make_interval(secs => ${retryDelaySeconds(attempts)}), updated_at = now()
        WHERE id = ${t.id}::uuid`;
      return "retrying";
    }
    return fail(t, stage, message, attempts);
  }
}

async function fail(t: ClaimedTarget, stage: Record<string, unknown>, message: string, attempts = t.attempts + 1): Promise<Outcome> {
  await prisma.$executeRaw`
    UPDATE social_post_targets SET status = 'failed', error = ${message.slice(0, 1000)}, attempts = ${attempts},
      stage = ${JSON.stringify(stage)}::jsonb, locked_until = NULL, updated_at = now()
    WHERE id = ${t.id}::uuid`;
  return "failed";
}

async function settlePost(postId: string): Promise<void> {
  const rows = await prisma.$queryRaw<{ status: TargetStatus; platform: Platform; name: string; error: string | null }[]>`
    SELECT t.status, a.platform, a.name, t.error
    FROM social_post_targets t JOIN social_accounts a ON a.id = t.account_id
    WHERE t.post_id = ${postId}::uuid`;
  const final = settledPostStatus(rows.map((r) => r.status));
  if (!final) return;
  const changed = await prisma.$executeRaw`
    UPDATE social_posts SET status = ${final}, updated_at = now() WHERE id = ${postId}::uuid AND status = 'publishing'`;
  if (changed !== 1 || final === "published") return;

  const failed = rows.filter((r) => r.status === "failed");
  await notifyAdmins({
    title: final === "failed" ? "A scheduled post failed" : "A post failed on some accounts",
    body: failed.map((f) => `${PLATFORM_LABEL[f.platform]} (${f.name}): ${f.error ?? "failed"}`).join(" · ").slice(0, 300),
    rows: failed.map((f) => [`${PLATFORM_LABEL[f.platform]} — ${f.name}`, f.error ?? "failed"]),
    where: "Social",
    emailSubject: "Social post failed",
    data: { postId },
    icon: "⚠️",
    section: "social",
    url: `/social/posts/${postId}`,
  }).catch(() => undefined);
}
