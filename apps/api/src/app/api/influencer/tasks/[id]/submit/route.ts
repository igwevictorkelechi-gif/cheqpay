import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { submitTaskProof } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Submit proof (a link and a note) for a task an admin checks by hand. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    await enforceRateLimit(`inf-proof:${auth.id}`, 20, 60 * 60_000);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Task not found", "not_found");
    const body = z.object({ proofUrl: z.string().url().max(500), note: z.string().max(1000).default("") }).parse(await req.json());
    await submitTaskProof(auth.id, id, body.proofUrl, body.note);
    return jsonOk({ ok: true }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
