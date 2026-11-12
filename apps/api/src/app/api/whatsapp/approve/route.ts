// apps/api/src/app/api/whatsapp/approve/route.ts
//
// The website side of a payment the WhatsApp bot composed.
//
//   GET  ?code=…   what the user is about to approve (reserves their daily cap)
//   DELETE ?code=… close it out once the payment has run
//
// The money itself never goes through here: the page takes what this returns
// and calls the SAME transfer / withdrawal / bill route the app calls, with the
// PIN the user types into the existing dialog. That is the point of the design
// — no second money path to get wrong.

import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { formatNairaMinor, fromMinorUnits } from "@/lib/money";
import {
  amountOf,
  approvePendingAction,
  burnPendingAction,
  idempotencyKeyFor,
  type ActionPayload,
} from "@/lib/whatsapp/actions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("whatsapp_bot");
    await enforceRateLimit(`wa-approve:${auth.id}`, 30, 60_000);

    const code = new URL(req.url).searchParams.get("code") ?? "";
    if (!code) throw new ApiError(400, "Missing code", "no_code");

    // Reserves the daily cap. Throws 403 wa_daily_cap if this would exceed it,
    // and 410 if the code is unknown, expired, spent, or belongs to someone
    // else — ownership is checked here, so an intercepted link is useless.
    const action = await approvePendingAction(code, auth.id);

    return jsonOk({
      ...render(action.payload),
      // Derived from the code, so a refresh or a double tap re-presents the
      // same key and the money route replays its original result instead of
      // paying twice.
      idempotencyKey: idempotencyKeyFor(code),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireUser(req);
    const code = new URL(req.url).searchParams.get("code") ?? "";
    if (code) await burnPendingAction(code, auth.id);
    // Always reports success: the idempotency key already makes a second
    // payment impossible, so a failed close-out is untidy, not dangerous.
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface Rendered {
  kind: ActionPayload["kind"];
  amount: string;
  amountFormatted: string;
  title: string;
  subtitle: string;
  /** Exactly what will be sent to the money route. */
  request: Record<string, string>;
}

/**
 * What the review screen shows and posts.
 *
 * Account numbers are cut to the last 4: this is rendered from a link that
 * arrived over WhatsApp, and the full number does not need to make that trip.
 */
function render(payload: ActionPayload): Rendered {
  const minor = amountOf(payload);
  const amount = fromMinorUnits(minor, "NGN");
  const base = { amount, amountFormatted: formatNairaMinor(minor) };

  switch (payload.kind) {
    case "transfer":
      return {
        ...base,
        kind: "transfer",
        title: `Send to @${payload.username}`,
        subtitle: "CheqPay user · arrives instantly",
        request: { username: payload.username, asset: "NGN", amount },
      };
    case "withdraw":
      return {
        ...base,
        kind: "withdraw",
        title: `Withdraw to ${payload.bankName}`,
        subtitle: `${payload.accountName} · ••••${payload.accountNumber.slice(-4)}`,
        request: { amount, bankCode: payload.bankCode, accountNumber: payload.accountNumber },
      };
    case "bill":
      return {
        ...base,
        kind: "bill",
        title: `Pay ${payload.billerName}`,
        subtitle: `${payload.service} · ${payload.customer}`,
        request: {
          service: payload.service,
          billerId: payload.billerId,
          customer: payload.customer,
          ...(payload.planId ? { planId: payload.planId } : { amount }),
        },
      };
  }
}
