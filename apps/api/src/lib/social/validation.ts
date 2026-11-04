// apps/api/src/lib/social/validation.ts

import { z } from "zod";
import { ApiError } from "../http";
import { PLATFORMS, type Platform } from "./rules";
import type { PostInput } from "./store";

const uuid = z.string().uuid();

export const postInputSchema = z.object({
  caption: z.string().max(63_206).default(""),
  overrides: z.record(z.enum(PLATFORMS), z.string().max(63_206)).default({}),
  mediaIds: z.array(uuid).max(35).default([]),
  accountIds: z.array(uuid).max(50).default([]),
  /** ISO time with offset; null or a past time means "as soon as it's approved". */
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export function parsePostInput(body: unknown): PostInput {
  const v = postInputSchema.parse(body);
  const scheduledAt = v.scheduledAt ? new Date(v.scheduledAt) : null;
  if (scheduledAt && scheduledAt.getTime() > Date.now() + 366 * 86400_000) {
    throw new ApiError(422, "Schedule posts within the next year.", "too_far");
  }
  if (new Set(v.mediaIds).size !== v.mediaIds.length) throw new ApiError(422, "The same file was added twice.", "dup_media");
  const overrides: Partial<Record<Platform, string>> = {};
  for (const [k, text] of Object.entries(v.overrides)) if (text.trim()) overrides[k as Platform] = text;
  return { caption: v.caption, overrides, mediaIds: v.mediaIds, accountIds: [...new Set(v.accountIds)], scheduledAt };
}

export const mediaCreateSchema = z.object({
  kind: z.enum(["image", "video"]),
  mime: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().max(20_000).nullable().optional(),
  height: z.number().int().positive().max(20_000).nullable().optional(),
});

export const rejectSchema = z.object({ note: z.string().trim().min(3, "Say what needs changing.").max(1000) });

export function assertUuid(id: string): string {
  if (!uuid.safeParse(id).success) throw new ApiError(404, "Not found.", "not_found");
  return id;
}
