import { z } from "zod";
import { fromPublicId } from "@cheqpay/devapi";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { alertOwner, recordDevAudit } from "@/lib/devapi/audit";
import { getApiKey, rollApiKey } from "@/lib/devapi/keys";
import { keyView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const schema = z.object({ keep_old_hours: z.number().int().min(0).max(24).default(0) }).strict();

/**
 * Replace a key: a new secret with the same settings, while the old one keeps
 * working for up to 24 hours so deployments can switch without downtime.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireDeveloper(req);
    const id = fromPublicId("key", (await params).id);
    const old = id ? await getApiKey(s.account.id, id) : null;
    if (!old) throw new ApiError(404, "No such key", "not_found");
    if (old.mode === "live") requireStepUp(s.user);
    const { keep_old_hours } = schema.parse(await req.json().catch(() => ({})));
    const { key, secret } = await rollApiKey(s.account, old.id, keep_old_hours);
    await recordDevAudit({
      accountId: s.account.id,
      actor: "owner",
      action: "key.rolled",
      target: old.id,
      details: { new_key: key.id, keep_old_hours },
      ip: s.ip,
      userAgent: s.userAgent,
    });
    if (old.mode === "live") {
      alertOwner(s.account, {
        title: "A live API key was rolled",
        body: `Your live key "${old.label}" was replaced by a new key ending ${key.last4}. The old key ${keep_old_hours ? `stops working in ${keep_old_hours} hour${keep_old_hours === 1 ? "" : "s"}` : "stopped working immediately"}.`,
        details: [{ label: "IP address", value: s.ip ?? "unknown" }],
      });
    }
    return jsonOk({ key: keyView(key), secret }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
