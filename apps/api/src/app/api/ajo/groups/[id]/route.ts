import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ajoGroupActionSchema } from "@/lib/validation";
import { cancelGroup, groupDetail, leaveGroup, startGroup } from "@/lib/ajo";
import { groupDetailView } from "@/lib/ajo/view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function groupId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!UUID.test(id)) throw new ApiError(404, "Group not found", "not_found");
  return id;
}

/** A group the caller belongs to: members, collecting order, who is behind, payouts so far. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    const id = await groupId(params);
    return jsonOk(groupDetailView(await groupDetail(auth.id, id), auth.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Before a group starts: the organiser starts or cancels it; other members may
 * leave. None of these moves money, so none needs the PIN.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await enforceRateLimit(`ajo:gact:${auth.id}`, 10, 60_000);
    const id = await groupId(params);
    const { action } = ajoGroupActionSchema.parse(await req.json());
    if (action === "start") await startGroup(auth.id, id);
    else if (action === "leave") await leaveGroup(auth.id, id);
    else await cancelGroup(auth.id, id);
    return jsonOk({ ok: true, action });
  } catch (err) {
    return toErrorResponse(err);
  }
}
