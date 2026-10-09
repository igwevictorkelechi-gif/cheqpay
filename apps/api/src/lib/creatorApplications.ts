// apps/api/src/lib/creatorApplications.ts
//
// Applying to the CheqPay Creators (influencer) program, and vetting it.
//
// A creator applies from the portal with their CheqPay account. We lean on the
// KYC the app already did instead of asking again: applying needs at least
// tier 1 (verified BVN), and the verified legal name — not a typed one — goes
// on the application. The rest is about the creator: where they post, how big
// and where their audience is, recent work, and a short background.
//
// Status: PENDING → APPROVED | REJECTED, or → NEEDS_INFO (the admin asked for
// something) → PENDING again when the creator updates it. A rejected creator
// may apply again after REAPPLY_DAYS.

import { TransactionStatus, prisma } from "@cheqpay/db";
import { z } from "zod";
import { notifyUser } from "./alerts";
import { ApiError } from "./http";
import { PORTAL_ORIGIN, codeFor, codeTaken, ensureReferralSchema, normalizeCode, upsertInfluencer } from "./referrals";

export const REAPPLY_DAYS = 30;
export const MIN_KYC_TIER = 1;

/** Where creators post, and the sites a link for each may point to. */
export const PLATFORMS = {
  instagram: { name: "Instagram", hosts: ["instagram.com"], profile: (h: string) => `https://www.instagram.com/${h}` },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"], profile: (h: string) => `https://www.tiktok.com/@${h}` },
  x: { name: "X", hosts: ["x.com", "twitter.com"], profile: (h: string) => `https://x.com/${h}` },
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"], profile: (h: string) => `https://www.youtube.com/@${h}` },
  facebook: { name: "Facebook", hosts: ["facebook.com", "fb.com", "fb.watch"], profile: (h: string) => `https://www.facebook.com/${h}` },
  snapchat: { name: "Snapchat", hosts: ["snapchat.com"], profile: (h: string) => `https://www.snapchat.com/add/${h}` },
  threads: { name: "Threads", hosts: ["threads.net", "threads.com"], profile: (h: string) => `https://www.threads.net/@${h}` },
  linkedin: { name: "LinkedIn", hosts: ["linkedin.com"], profile: (h: string) => `https://www.linkedin.com/in/${h}` },
  other: { name: "Other", hosts: [] as string[], profile: null },
} as const;
export type Platform = keyof typeof PLATFORMS;
const PLATFORM_KEYS = Object.keys(PLATFORMS) as [Platform, ...Platform[]];

export const FOLLOWER_BANDS = ["<1k", "1k-10k", "10k-50k", "50k-100k", "100k-500k", "500k-1m", "1m+"] as const;
export const VIEW_BANDS = ["<1k", "1k-5k", "5k-20k", "20k-100k", "100k+"] as const;
export const NICHES = [
  "Finance", "Tech", "Crypto", "Lifestyle", "Comedy", "Fashion", "Beauty", "Music", "Sports", "Gaming",
  "Education", "Travel", "Food", "Business", "Faith", "Family", "Health", "News",
] as const;

/** True if `host` is `domain` or a subdomain of it. */
function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** A public https link (no credentials, no odd ports), or null. */
export function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    if (!u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith("[")) return null;
    return u;
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS = PLATFORM_KEYS.flatMap((k) => PLATFORMS[k].hosts);

/** "@Ada.Obi " → "Ada.Obi". Handles are letters, digits, dot, underscore and dash. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\/+$/, "");
}

const social = z
  .object({
    platform: z.enum(PLATFORM_KEYS),
    handle: z.string().max(80),
    followers: z.enum(FOLLOWER_BANDS),
    url: z.string().max(300).optional(),
  })
  .strict()
  .transform((s, ctx) => {
    const handle = normalizeHandle(s.handle);
    const p = PLATFORMS[s.platform];
    const okHandle = s.platform === "other" ? /^.{2,60}$/.test(handle) : /^[A-Za-z0-9._-]{1,60}$/.test(handle);
    if (!okHandle) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Check your ${p.name} handle.`, path: ["handle"] });
      return z.NEVER;
    }
    let url: string | null = null;
    if (s.url?.trim()) {
      const u = httpsUrl(s.url);
      if (!u || (p.hosts.length && !p.hosts.some((d) => onDomain(u.hostname, d)))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Use your ${p.name} profile link (https://…).`, path: ["url"] });
        return z.NEVER;
      }
      url = u.toString();
    } else if (p.profile) {
      url = p.profile(handle);
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add a link to your profile.", path: ["url"] });
      return z.NEVER;
    }
    return { platform: s.platform, handle, followers: s.followers, url };
  });

export const applicationSchema = z
  .object({
    phone: z.string().trim().max(40).optional(),
    socials: z.array(social).min(1, "Add at least one platform.").max(6),
    niches: z.array(z.enum(NICHES)).min(1, "Pick at least one topic.").max(3),
    audienceLocation: z.string().trim().min(2).max(80),
    avgViews: z.enum(VIEW_BANDS),
    sampleLinks: z.array(z.string().max(300)).min(1, "Add a link to a recent post.").max(3),
    bio: z.string().trim().min(20, "Tell us a little more about you.").max(500),
    priorBrands: z.string().trim().max(300).default(""),
    why: z.string().trim().min(10, "Tell us a little more.").max(500),
    preferredCode: z.string().trim().max(40).optional(),
    agreeTerms: z.literal(true, { errorMap: () => ({ message: "Please agree to the Creator terms." }) }),
  })
  .strict()
  .superRefine((a, ctx) => {
    // Runs even when a field above failed, so only trust what parsed.
    const socials = a.socials.filter((s) => s && typeof s.handle === "string" && typeof s.url === "string");
    const seen = new Set<string>();
    socials.forEach((s, i) => {
      const key = `${s.platform}:${s.handle.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That account is listed twice.", path: ["socials", i] });
      seen.add(key);
    });
    // Recent posts must be on a social platform — or on a site the creator listed under "Other".
    const extra = socials.filter((s) => s.platform === "other").map((s) => httpsUrl(s.url)?.hostname ?? "").filter(Boolean);
    a.sampleLinks.forEach((l, i) => {
      const u = typeof l === "string" ? httpsUrl(l) : null;
      if (!u || ![...SOCIAL_HOSTS, ...extra].some((d) => onDomain(u.hostname, d))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a link to one of your posts (https://…).", path: ["sampleLinks", i] });
      }
    });
    if (a.phone && !/^\+?[\d\s()-]{7,20}$/.test(a.phone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check your phone number.", path: ["phone"] });
    }
  });
export type ApplicationInput = z.infer<typeof applicationSchema>;

// ---------------------------------------------------------------------------
// The creator's side

interface AppRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  socials: unknown[];
  niche: string;
  niches: string[];
  location: string;
  audience_location: string;
  avg_views: string | null;
  sample_links: string[];
  bio: string;
  prior_brands: string;
  why: string;
  preferred_code: string | null;
  status: string;
  reason: string | null;
  request_note: string | null;
  reapply_after: Date | null;
  kyc_tier_at_apply: number | null;
  legal_name_at_apply: string | null;
  terms_accepted_at: Date | null;
  submissions: number;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const APP_COLS = `a.id::text, a.user_id::text, a.full_name, a.phone, a.socials, a.niche, a.niches, a.location, a.audience_location,
  a.avg_views, a.sample_links, a.bio, a.prior_brands, a.why, a.preferred_code, a.status, a.reason, a.request_note, a.reapply_after,
  a.kyc_tier_at_apply, a.legal_name_at_apply, a.terms_accepted_at, a.submissions, a.reviewed_by, a.reviewed_at, a.created_at, a.updated_at`;

function view(a: AppRow) {
  return {
    id: a.id,
    fullName: a.full_name,
    phone: a.phone,
    socials: a.socials,
    niches: a.niches.length ? a.niches : a.niche ? [a.niche] : [],
    audienceLocation: a.audience_location || a.location,
    avgViews: a.avg_views,
    sampleLinks: a.sample_links,
    bio: a.bio,
    priorBrands: a.prior_brands,
    why: a.why,
    preferredCode: a.preferred_code,
    status: a.status,
    reason: a.reason,
    requestNote: a.request_note,
    reapplyAfter: a.reapply_after?.toISOString() ?? null,
    submissions: a.submissions,
    reviewedAt: a.reviewed_at?.toISOString() ?? null,
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}

/** May this application be (re)submitted now? */
export function canSubmit(a: Pick<AppRow, "status" | "reapply_after"> | null, now = new Date()): boolean {
  if (!a) return true;
  if (a.status === "NEEDS_INFO") return true;
  if (a.status === "REJECTED") return !a.reapply_after || a.reapply_after <= now;
  return false;
}

async function appFor(userId: string): Promise<AppRow | null> {
  const rows = await prisma.$queryRawUnsafe<AppRow[]>(`SELECT ${APP_COLS} FROM influencer_applications a WHERE a.user_id = $1::uuid`, userId);
  return rows[0] ?? null;
}

/** The portal's view: who you are to us (KYC), whether you're in, and your application. */
export async function getApplication(userId: string) {
  await ensureReferralSchema();
  const [user, code, a] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, kycTier: true, legalName: true, phone: true } }),
    codeFor(userId),
    appFor(userId),
  ]);
  if (!user) throw new ApiError(404, "Account not found", "not_found");
  return {
    isInfluencer: code?.kind === "INFLUENCER" && code.active,
    me: {
      email: user.email,
      kycTier: user.kycTier,
      verified: user.kycTier >= MIN_KYC_TIER,
      legalName: user.legalName,
      hasPhone: !!user.phone,
      code: code?.code ?? null,
    },
    canSubmit: canSubmit(a),
    application: a ? view(a) : null,
  };
}

/** Is this code free for this user to ask for? */
export async function codeAvailability(userId: string, raw: string): Promise<{ code: string | null; available: boolean; reason?: string }> {
  await ensureReferralSchema();
  const code = normalizeCode(raw);
  if (!code) return { code: null, available: false, reason: "Use 4–16 letters or numbers." };
  if (await codeTaken(code, userId)) return { code, available: false, reason: "That code is taken." };
  return { code, available: true };
}

/** Apply, update after an admin asked for more, or apply again after the wait. */
export async function submitApplication(userId: string, input: ApplicationInput): Promise<void> {
  await ensureReferralSchema();
  const [user, code, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, kycTier: true, legalName: true, phone: true } }),
    codeFor(userId),
    appFor(userId),
  ]);
  if (!user) throw new ApiError(404, "Account not found", "not_found");
  if (code?.kind === "INFLUENCER") throw new ApiError(409, "You're already a CheqPay Creator.", "already_influencer");
  if (user.kycTier < MIN_KYC_TIER) {
    throw new ApiError(403, "Verify your identity in the CheqPay app first, then come back to apply.", "verify_identity_first");
  }
  if (!canSubmit(existing)) throw refusal(existing!);

  const phone = input.phone?.trim() || user.phone || "";
  if (!phone) throw new ApiError(422, "Add a phone number we can reach you on.", "phone_required");
  const preferred = input.preferredCode ? normalizeCode(input.preferredCode) : null;
  if (input.preferredCode && !preferred) throw new ApiError(422, "Codes are 4–16 letters or numbers.", "bad_code");
  if (preferred && (await codeTaken(preferred, userId))) throw new ApiError(409, "That code is taken. Try another.", "code_taken");

  const fullName = (user.legalName?.trim() || user.email).slice(0, 120);
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO influencer_applications (user_id, full_name, phone, socials, niche, niches, location, audience_location, avg_views,
        sample_links, bio, prior_brands, why, preferred_code, kyc_tier_at_apply, legal_name_at_apply, terms_accepted_at)
     VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6::text[], $7, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, now())
     ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, socials = EXCLUDED.socials,
       niche = EXCLUDED.niche, niches = EXCLUDED.niches, location = EXCLUDED.location, audience_location = EXCLUDED.audience_location,
       avg_views = EXCLUDED.avg_views, sample_links = EXCLUDED.sample_links, bio = EXCLUDED.bio, prior_brands = EXCLUDED.prior_brands,
       why = EXCLUDED.why, preferred_code = EXCLUDED.preferred_code, kyc_tier_at_apply = EXCLUDED.kyc_tier_at_apply,
       legal_name_at_apply = EXCLUDED.legal_name_at_apply, terms_accepted_at = now(),
       status = 'PENDING', reason = NULL, reviewed_by = NULL, reviewed_at = NULL, reapply_after = NULL,
       submissions = influencer_applications.submissions + 1, updated_at = now()
     WHERE influencer_applications.status = 'NEEDS_INFO'
        OR (influencer_applications.status = 'REJECTED' AND (influencer_applications.reapply_after IS NULL OR influencer_applications.reapply_after <= now()))`,
    userId,
    fullName,
    phone.slice(0, 40),
    JSON.stringify(input.socials),
    input.niches[0],
    input.niches,
    input.audienceLocation,
    input.avgViews,
    JSON.stringify(input.sampleLinks.map((l) => httpsUrl(l)!.toString())),
    input.bio,
    input.priorBrands,
    input.why,
    preferred,
    user.kycTier,
    user.legalName,
  );
  if (!n) throw refusal((await appFor(userId)) ?? existing!);

  await notifyUser(userId, {
    category: "updates",
    title: existing?.status === "NEEDS_INFO" ? "Thanks — we've got your update" : "We've got your creator application",
    body: "Our team will review it and get back to you, usually within 2 working days.",
    data: { url: `${PORTAL_ORIGIN}/apply` },
  }).catch(() => undefined);
}

function refusal(a: Pick<AppRow, "status" | "reapply_after">): ApiError {
  if (a.status === "PENDING") return new ApiError(409, "Your application is being reviewed.", "already_applied");
  if (a.status === "REJECTED" && a.reapply_after) {
    const when = a.reapply_after.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
    return new ApiError(409, `You can apply again from ${when}.`, "reapply_not_yet");
  }
  return new ApiError(409, "This application has already been decided.", "already_decided");
}

// ---------------------------------------------------------------------------
// Admin

export const ADMIN_STATUSES = ["PENDING", "NEEDS_INFO", "APPROVED", "REJECTED", "ALL"] as const;

export async function listApplicationsAdmin(status = "PENDING", q = "") {
  await ensureReferralSchema();
  const search = q.trim().toLowerCase().slice(0, 80);
  const rows = await prisma.$queryRawUnsafe<(AppRow & { email: string; kyc_tier: number })[]>(
    `SELECT ${APP_COLS}, u.email, u.kyc_tier
       FROM influencer_applications a JOIN app_users u ON u.id = a.user_id
      WHERE ($1 = 'ALL' OR a.status = $1)
        AND ($2 = '' OR lower(u.email) LIKE '%' || $2 || '%' OR lower(a.full_name) LIKE '%' || $2 || '%'
             OR lower(a.socials::text) LIKE '%' || $2 || '%' OR lower(coalesce(a.preferred_code, '')) LIKE '%' || $2 || '%')
      ORDER BY ${status === "PENDING" ? "a.updated_at ASC" : "a.updated_at DESC"} LIMIT 300`,
    status,
    search,
  );
  return rows.map((a) => ({ ...view(a), userId: a.user_id, email: a.email, kycTier: a.kyc_tier, reviewedBy: a.reviewed_by }));
}

/** One application with everything an admin needs to vet the person behind it. */
export async function getApplicationAdmin(id: string) {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<AppRow[]>(`SELECT ${APP_COLS} FROM influencer_applications a WHERE a.id = $1::uuid`, id);
  const a = rows[0];
  if (!a) throw new ApiError(404, "Not found", "not_found");
  const user = await prisma.user.findUnique({
    where: { id: a.user_id },
    select: { id: true, email: true, username: true, phone: true, kycTier: true, legalName: true, status: true, createdAt: true, bvnFingerprint: true },
  });
  if (!user) throw new ApiError(404, "Not found", "not_found");

  const [bvnShared, referredBy, phoneMatches, referrals, txns] = await Promise.all([
    user.bvnFingerprint
      ? prisma.user.count({ where: { bvnFingerprint: user.bvnFingerprint, id: { not: user.id } } })
      : Promise.resolve(0),
    prisma.$queryRawUnsafe<{ code: string }[]>(`SELECT code FROM referrals WHERE referred_user_id = $1::uuid`, user.id),
    prisma.$queryRawUnsafe<{ id: string; email: string; status: string }[]>(
      `SELECT a.id::text, u.email, a.status FROM influencer_applications a JOIN app_users u ON u.id = a.user_id
        WHERE a.id <> $1::uuid AND regexp_replace(a.phone, '\\D', '', 'g') <> ''
          AND right(regexp_replace(a.phone, '\\D', '', 'g'), 10) = right(regexp_replace($2, '\\D', '', 'g'), 10) LIMIT 10`,
      a.id,
      a.phone,
    ),
    prisma.$queryRawUnsafe<{ status: string; n: bigint }[]>(
      `SELECT status, count(*) AS n FROM referrals WHERE referrer_user_id = $1::uuid GROUP BY status`,
      user.id,
    ),
    prisma.transaction.count({ where: { userId: user.id, status: TransactionStatus.COMPLETED } }),
  ]);
  const ref = (s: string) => Number(referrals.find((r) => r.status === s)?.n ?? 0);

  return {
    application: { ...view(a), reviewedBy: a.reviewed_by, kycTierAtApply: a.kyc_tier_at_apply, legalNameAtApply: a.legal_name_at_apply, termsAcceptedAt: a.terms_accepted_at?.toISOString() ?? null },
    vetting: {
      userId: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone,
      kycTier: user.kycTier,
      legalName: user.legalName,
      accountStatus: user.status,
      accountCreatedAt: user.createdAt.toISOString(),
      accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
      completedTransactions: txns,
      bvnSharedWith: bvnShared,
      referredBy: referredBy[0]?.code ?? null,
      referrals: { signedUp: ref("SIGNED_UP") + ref("QUALIFIED"), qualified: ref("QUALIFIED") },
      phoneMatches,
    },
  };
}

export type Decision =
  | { action: "approve"; code: string; commissionPercent: number; windowDays: number | null }
  | { action: "reject"; reason: string }
  | { action: "request_info"; note: string };

export async function decideApplication(id: string, admin: string, d: Decision): Promise<{ userId: string }> {
  await ensureReferralSchema();
  // Approve or reject from either open state; only ask for more while it's with us.
  const from = d.action === "request_info" ? ["PENDING"] : ["PENDING", "NEEDS_INFO"];
  const rows = await prisma.$queryRawUnsafe<{ user_id: string; email: string; status: string }[]>(
    `SELECT a.user_id::text, u.email, a.status FROM influencer_applications a JOIN app_users u ON u.id = a.user_id WHERE a.id = $1::uuid`,
    id,
  );
  const a = rows[0];
  if (!a) throw new ApiError(404, "Not found", "not_found");
  if (!from.includes(a.status)) throw new ApiError(409, "This application has already been decided.", "already_decided");

  // Each flip is guarded on the status we just read, so two admins can't both decide it.
  const flip = async (sql: string, ...args: unknown[]) => {
    const n = await prisma.$executeRawUnsafe(`${sql} WHERE id = $1::uuid AND status = ANY($2::text[])`, id, from, admin, ...args);
    if (!n) throw new ApiError(409, "This application has already been decided.", "already_decided");
  };

  if (d.action === "approve") {
    const code = normalizeCode(d.code);
    if (!code) throw new ApiError(422, "Codes are 4–16 letters or numbers.", "bad_code");
    await flip(`UPDATE influencer_applications SET status = 'APPROVED', request_note = NULL, reviewed_by = $3, reviewed_at = now(), updated_at = now()`);
    await upsertInfluencer({ user: a.email, code, commissionPercent: d.commissionPercent, windowDays: d.windowDays, active: true }).catch(async (err) => {
      // Put it back so the admin can try again with another code.
      await prisma.$executeRawUnsafe(`UPDATE influencer_applications SET status = $2, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1::uuid`, id, a.status);
      throw err;
    });
    await notifyUser(a.user_id, {
      category: "updates",
      title: "You're a CheqPay Creator 🎉",
      body: `Welcome aboard. Your code is ${code} — open your creator dashboard to start sharing.`,
      data: { url: `${PORTAL_ORIGIN}/dashboard` },
    }).catch(() => undefined);
  } else if (d.action === "request_info") {
    const note = d.note.trim().slice(0, 500);
    if (note.length < 3) throw new ApiError(422, "Say what you need from them.", "note_required");
    await flip(`UPDATE influencer_applications SET status = 'NEEDS_INFO', request_note = $4, reviewed_by = $3, reviewed_at = now(), updated_at = now()`, note);
    await notifyUser(a.user_id, {
      category: "updates",
      title: "We need a little more for your creator application",
      body: note,
      data: { url: `${PORTAL_ORIGIN}/apply` },
    }).catch(() => undefined);
  } else {
    const why = d.reason.trim().slice(0, 300);
    if (why.length < 3) throw new ApiError(422, "Give a reason.", "reason_required");
    await flip(
      `UPDATE influencer_applications SET status = 'REJECTED', reason = $4, request_note = NULL, reviewed_by = $3, reviewed_at = now(),
         reapply_after = now() + make_interval(days => $5::int), updated_at = now()`,
      why,
      REAPPLY_DAYS,
    );
    await notifyUser(a.user_id, {
      category: "updates",
      title: "About your creator application",
      body: `We can't add you to CheqPay Creators right now: ${why} You can apply again in ${REAPPLY_DAYS} days.`,
      data: { url: `${PORTAL_ORIGIN}/apply` },
    }).catch(() => undefined);
  }
  return { userId: a.user_id };
}
