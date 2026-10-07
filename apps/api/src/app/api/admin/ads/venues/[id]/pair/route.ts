import { z } from "zod";
import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { pairScreen } from "@/lib/adsVenues";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Pair the screen showing this 6-digit code with the venue. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const b = z.object({ code: z.string().regex(/^\d{6}$/), label: z.string().max(60).default("") }).parse(await req.json());
    const r = await pairScreen(id, b.code, b.label);
    await recordAdminAction(req, actor, { action: "admin.ads.screen_paired", summary: `Screen paired to venue ${id}`, resourceType: "AdScreen", resourceId: r.screenId });
    return jsonOk(r);
  } catch (err) {
    return toErrorResponse(err);
  }
}
