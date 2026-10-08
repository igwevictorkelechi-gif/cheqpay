import { z } from "zod";
import { fromPublicId } from "@cheqpay/devapi";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { alertOwner, recordDevAudit } from "@/lib/devapi/audit";
import { getApiKey, revokeApiKey, updateApiKey } from "@/lib/devapi/keys";
import { keyView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadKey(accountId: string, publicId: string) {
  const id = fromPublicId("key", publicId);
  const key = id ? await getApiKey(accountId, id) : null;
  if (!key) throw new ApiError(404, "No such key", "not_found");
  return key;
}

const patchSchema = z
  .object({
    label: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    allowed_ips: z.array(z.string()).optional(),
  })
  .strict();

/** Rename a key, change its scopes or its IP allowlist. Live keys need 2FA. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const s = await requireDeveloper(req);
    const key = await loadKey(s.account.id, (await params).id);
    if (key.mode === "live") requireStepUp(s.user);
    const body = patchSchema.parse(await req.json());
    const updated = await updateApiKey(s.account, key.id, { label: body.label, scopes: body.scopes, allowedIps: body.allowed_ips });
    await recordDevAudit({
      accountId: s.account.id,
      actor: "owner",
      action: "key.updated",
      target: key.id,
      details: { before: { scopes: key.scopes, allowed_ips: key.allowed_ips }, after: { scopes: updated.scopes, allowed_ips: updated.allowed_ips } },
      ip: s.ip,
      userAgent: s.userAgent,
    });
    if (key.mode === "live" && (body.scopes || body.allowed_ips)) {
      alertOwner(s.account, {
        title: "A live API key was changed",
        body: `The scopes or IP allowlist of your live key "${updated.label}" (ending ${updated.last4}) changed.`,
        details: [{ label: "IP address", value: s.ip ?? "unknown" }],
      });
    }
    return jsonOk({ key: keyView(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Revoke a key now. Live keys need 2FA. */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const s = await requireDeveloper(req);
    const key = await loadKey(s.account.id, (await params).id);
    if (key.mode === "live") requireStepUp(s.user);
    const revoked = await revokeApiKey(s.account.id, key.id, "revoked by the owner");
    await recordDevAudit({ accountId: s.account.id, actor: "owner", action: "key.revoked", target: key.id, ip: s.ip, userAgent: s.userAgent });
    if (key.mode === "live") {
      alertOwner(s.account, {
        title: "A live API key was revoked",
        body: `Your live key "${key.label}" (ending ${key.last4}) was revoked and no longer works.`,
        details: [{ label: "IP address", value: s.ip ?? "unknown" }],
      });
    }
    return jsonOk({ key: keyView(revoked) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
