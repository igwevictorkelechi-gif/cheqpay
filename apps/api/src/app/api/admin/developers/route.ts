import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { adminListAccounts } from "@/lib/devapi/admin";
import type { AccountStatus } from "@/lib/devapi/types";

export const dynamic = "force-dynamic";

const STATUSES: AccountStatus[] = ["sandbox", "pending_review", "approved", "rejected", "suspended"];

/** Developer accounts, applications waiting for review first. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const s = new URL(req.url).searchParams.get("status");
    const status = s && (STATUSES as string[]).includes(s) ? (s as AccountStatus) : null;
    return jsonOk({ accounts: await adminListAccounts(status) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
