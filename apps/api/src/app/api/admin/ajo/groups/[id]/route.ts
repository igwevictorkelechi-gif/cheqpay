import { z } from "zod";
import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ajoGroupAdminDetail } from "@/lib/ajo/admin";

export const dynamic = "force-dynamic";

/** Admin: one group — members with what each owes, and every round's payout. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminActor(req, { section: "ajo" });
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "Group not found", "not_found");
    return jsonOk(await ajoGroupAdminDetail(id));
  } catch (err) {
    return toErrorResponse(err);
  }
}
