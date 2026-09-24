import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { blockIps, listBlockedIps, unblockIp } from "@/lib/accessControl";

export const dynamic = "force-dynamic";

/** Admin: the IP blocklist. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const rows = await listBlockedIps();
    return jsonOk({
      ips: rows.map((r) => ({
        ip: r.ip,
        reason: r.reason,
        sourceUserId: r.sourceUserId,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: block an address. Any admin — blocking is taking trust away, and a
 * block that waits on a second person is a block that arrives too late.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const body = (await req.json().catch(() => ({}))) as { ip?: unknown; reason?: unknown };
    const ip = String(body.ip ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!ip) throw new ApiError(422, "Enter an IP address", "validation_error");
    if (reason.length < 3) throw new ApiError(422, "Give a reason for the block", "reason_required");

    const added = await blockIps([ip], { reason, actor: actor.email });
    if (added.length === 0) throw new ApiError(422, "That doesn't look like an IP address", "validation_error");

    await recordAdminAction(req, actor, {
      action: "security.ip.blocked",
      summary: `IP ${added[0]} blocked`,
      resourceType: "blocked_ips",
      resourceId: added[0],
      details: { ip: added[0], reason },
    });
    return jsonOk({ ok: true, ip: added[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: unblock an address. Super Admin + a fresh authenticator code + a
 * reason — letting an address back in is granting trust, and the addresses on
 * this list got there for a reason.
 */
export async function DELETE(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = (await req.json().catch(() => ({}))) as { ip?: unknown; reason?: unknown; otp?: unknown };
    const ip = String(body.ip ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!ip) throw new ApiError(422, "Which IP?", "validation_error");
    if (reason.length < 10) {
      throw new ApiError(422, "Give a reason (at least 10 characters) — it goes on the audit record.", "reason_required");
    }
    await requireAdminOtp(req, body.otp);

    const removed = await unblockIp(ip);
    if (!removed) throw new ApiError(404, "That IP isn't on the blocklist", "not_found");

    await recordAdminAction(req, actor, {
      action: "security.ip.unblocked",
      summary: `IP ${ip} unblocked`,
      resourceType: "blocked_ips",
      resourceId: ip,
      details: { ip, reason },
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
