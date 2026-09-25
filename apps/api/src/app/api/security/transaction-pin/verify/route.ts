import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  requireTransactionPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "@/lib/transactionPin";

export const dynamic = "force-dynamic";

const schema = z.object({
  pin: z.string().min(PIN_MIN_LENGTH).max(PIN_MAX_LENGTH),
});

/**
 * Check a PIN without moving any money.
 *
 * Exists for one job: the mobile app must prove a PIN is correct before it
 * stores a copy for Face ID to submit. Storing an unverified PIN would let
 * biometrics quietly send a wrong one and walk the account into its own
 * lockout without the user ever typing a digit.
 *
 * This is not a new attack surface. It runs through the SAME gate the payment
 * routes use, so a wrong PIN counts toward the same lockout and an attacker
 * learns nothing here they could not learn by attempting a 1-kobo transfer.
 * What it avoids is the alternative: inferring correctness from the error code
 * of a change-PIN call, which worked but read as a trick and would break the
 * moment that route's messages changed.
 *
 * enforce: true — verifying a PIN that does not exist is meaningless, so this
 * answers 428 regardless of the platform-wide requirement switch.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`pin-verify:${auth.id}`, 10, 60_000);

    const { pin } = schema.parse(await req.json());
    // Throws on wrong, locked or missing — so reaching the next line means yes.
    await requireTransactionPin(auth.id, pin, { enforce: true });

    return jsonOk({ valid: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
