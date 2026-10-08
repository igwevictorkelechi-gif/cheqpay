import { toPublicId } from "@cheqpay/devapi";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { listDevAudit } from "@/lib/devapi/audit";

export const dynamic = "force-dynamic";

/** The security log: every change to the account, who made it and from where. */
export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const rows = await listDevAudit(s.account.id, 200);
    return jsonOk({
      events: rows.map((r) => ({
        id: r.id,
        actor: r.actor.startsWith("admin:") ? "CheqPay" : r.actor.startsWith("key:") ? "API key" : r.actor === "system" ? "System" : "You",
        action: r.action,
        target: r.target && /^[0-9a-f-]{36}$/.test(r.target) && r.action.startsWith("key.") ? toPublicId("key", r.target) : r.target,
        details: r.details,
        ip: r.ip,
        user_agent: r.user_agent,
        created_at: r.created_at.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
