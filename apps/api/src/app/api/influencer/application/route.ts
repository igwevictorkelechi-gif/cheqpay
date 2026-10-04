import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getApplication, submitApplication } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const schema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().min(5).max(40),
  socials: z
    .array(z.object({ platform: z.string().min(1).max(30), handle: z.string().max(120), followers: z.number().int().min(0).max(1_000_000_000) }))
    .min(1)
    .max(8),
  niche: z.string().max(120).default(""),
  location: z.string().max(120).default(""),
  why: z.string().max(1000).default(""),
  preferredCode: z.string().max(40).optional(),
});

/** The caller's influencer application (and whether they're already in). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    return jsonOk(await getApplication(auth.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Apply to the influencer program (or re-apply after a rejection). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    await enforceRateLimit(`inf-apply:${auth.id}`, 5, 60 * 60_000);
    await submitApplication(auth.id, schema.parse(await req.json()));
    return jsonOk(await getApplication(auth.id), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
