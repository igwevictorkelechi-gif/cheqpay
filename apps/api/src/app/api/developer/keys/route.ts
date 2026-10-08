import { z } from "zod";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getSubscription, liveAccessProblem } from "@/lib/devapi/billing";
import { requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { alertOwner, recordDevAudit } from "@/lib/devapi/audit";
import { createApiKey, listApiKeys } from "@/lib/devapi/keys";
import { getPlans } from "@/lib/devapi/plans";
import { keyView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    return jsonOk({ keys: (await listApiKeys(s.account.id)).map((k) => keyView(k)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z
  .object({
    mode: z.enum(["test", "live"]),
    label: z.string(),
    scopes: z.array(z.string()).optional(),
    allowed_ips: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Create a key. The secret is in this response and never again. A live key
 * needs live access (verified business + paid plan) and a 2FA-confirmed session.
 */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const body = schema.parse(await req.json());
    await enforceRateLimit(`dev:keys:create:${s.account.id}`, 20, 60 * 60_000);
    if (body.mode === "live") {
      requireStepUp(s.user);
      if (s.account.frozen) throw new ApiError(403, "Money movement is paused on this account.", "account_frozen");
      const problem = liveAccessProblem(s.account, await getSubscription(s.account.id), await getPlans());
      if (problem) throw new ApiError(problem.status, problem.message, problem.code);
    }
    const { key, secret } = await createApiKey(s.account, {
      mode: body.mode,
      label: body.label,
      scopes: body.scopes,
      allowedIps: body.allowed_ips,
    });
    await recordDevAudit({
      accountId: s.account.id,
      actor: "owner",
      action: "key.created",
      target: key.id,
      details: { mode: key.mode, label: key.label, scopes: key.scopes, allowed_ips: key.allowed_ips },
      ip: s.ip,
      userAgent: s.userAgent,
    });
    if (key.mode === "live") {
      alertOwner(s.account, {
        title: "A live API key was created",
        body: `A new live key "${key.label}" (ending ${key.last4}) was created on your developer account.`,
        details: [{ label: "IP address", value: s.ip ?? "unknown" }],
      });
    }
    return jsonOk({ key: keyView(key), secret }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
