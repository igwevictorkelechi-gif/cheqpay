import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  getPinStatus,
  setTransactionPin,
  requireTransactionPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "@/lib/transactionPin";
import { prisma } from "@cheqpay/db";

export const dynamic = "force-dynamic";

// The PIN itself is only ever read from the body on THESE routes — the ones
// whose entire job is to carry a new PIN. Money routes read it from a header
// (see lib/transactionPin.ts) so it can never be spread into a stored payload.
const pinField = z
  .string()
  .min(PIN_MIN_LENGTH, `PIN must be at least ${PIN_MIN_LENGTH} digits`)
  .max(PIN_MAX_LENGTH, `PIN must be at most ${PIN_MAX_LENGTH} digits`);

const createSchema = z.object({ pin: pinField });
const changeSchema = z.object({ currentPin: pinField, pin: pinField });

/** Whether a PIN is set, and whether it is currently locked. Reveals nothing. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const status = await getPinStatus(auth.id);
    return jsonOk({
      isSet: status.isSet,
      locked: status.lockedUntil !== null,
      lockedUntil: status.lockedUntil?.toISOString() ?? null,
      attemptsRemaining: status.attemptsRemaining,
      minLength: PIN_MIN_LENGTH,
      maxLength: PIN_MAX_LENGTH,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Set the PIN for the first time.
 *
 * Deliberately refuses when a PIN already exists: replacing one requires
 * proving you know the old one (PUT below). Without that rule, a hijacked
 * session could simply overwrite the PIN and defeat the control entirely.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    enforceRateLimit(`pin-set:${auth.id}`, 5, 60_000);

    const { pin } = createSchema.parse(await req.json());

    const status = await getPinStatus(auth.id);
    if (status.isSet) {
      throw new ApiError(
        409,
        "You already have a transaction PIN. Change it instead.",
        "pin_already_set",
      );
    }

    await setTransactionPin(auth.id, pin);
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "security.transaction_pin.created",
        resourceType: "User",
        resourceId: auth.id,
        details: {},
      },
    });

    return jsonOk({ isSet: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Change the PIN. The current PIN is verified through the same gate money
 * movement uses, so a wrong one counts toward the lockout — otherwise this
 * route would be an unlimited oracle for guessing the PIN.
 */
export async function PUT(req: Request) {
  try {
    const auth = await requireUser(req);
    enforceRateLimit(`pin-change:${auth.id}`, 5, 60_000);

    const { currentPin, pin } = changeSchema.parse(await req.json());

    // enforce: changing a PIN you do not have is meaningless, so this refuses
    // regardless of whether the platform-wide requirement is switched on yet.
    await requireTransactionPin(auth.id, currentPin, { enforce: true });

    if (currentPin === pin) {
      throw new ApiError(
        422,
        "Your new PIN must be different from your current one.",
        "pin_unchanged",
      );
    }

    await setTransactionPin(auth.id, pin);
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "security.transaction_pin.changed",
        resourceType: "User",
        resourceId: auth.id,
        details: {},
      },
    });

    return jsonOk({ isSet: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
