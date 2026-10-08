import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getAccount } from "@/lib/devapi/accounts";
import { readDevFile } from "@/lib/devapi/files";
import { recordDevAudit } from "@/lib/devapi/audit";

export const dynamic = "force-dynamic";

/** The business's registration certificate, decrypted for review. Every view is recorded. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    const account = /^[0-9a-f-]{36}$/i.test(id) ? await getAccount(id) : null;
    if (!account?.cac_file_id) throw new ApiError(404, "No document on file", "not_found");
    const file = await readDevFile(account.cac_file_id);
    if (!file || file.accountId !== account.id) throw new ApiError(404, "No document on file", "not_found");
    await recordDevAudit({ accountId: account.id, actor: `admin:${actor.email}`, action: "admin.document_viewed" });
    await recordAdminAction(req, actor, {
      action: "admin.developer.document_viewed",
      summary: `Viewed the registration document of ${account.business_name}`,
      userId: account.owner_user_id,
      resourceType: "DeveloperAccount",
      resourceId: account.id,
    });
    return jsonOk({ content_type: file.contentType, data_url: `data:${file.contentType};base64,${file.bytes.toString("base64")}` });
  } catch (err) {
    return toErrorResponse(err);
  }
}
