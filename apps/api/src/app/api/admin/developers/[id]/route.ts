import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { adminAccountDetail } from "@/lib/devapi/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    const detail = UUID.test(id) ? await adminAccountDetail(id) : null;
    if (!detail) throw new ApiError(404, "No such developer account", "not_found");
    return jsonOk(detail);
  } catch (err) {
    return toErrorResponse(err);
  }
}
