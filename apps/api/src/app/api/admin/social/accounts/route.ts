import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listAccounts } from "@/lib/social/store";

export const dynamic = "force-dynamic";

/** Admin (Social): connected accounts. Never includes tokens. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "social" });
    return jsonOk({ accounts: await listAccounts() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
