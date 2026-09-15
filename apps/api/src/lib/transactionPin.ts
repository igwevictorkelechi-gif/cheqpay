// apps/api/src/lib/transactionPin.ts
//
// The transaction PIN: a short secret the user types to authorise money
// leaving their account. It is deliberately a SECOND factor of a different
// kind from the session — a stolen session token moves no money without it.
//
// Why a PIN and not a password: the threat this defends against is an
// unlocked phone or a hijacked session, not a weak credential. A 4–6 digit
// PIN is what Nigerian banking has trained people to expect at the moment of
// payment, and asking for it per transaction is the whole point.
//
// The security trade-off that shapes this file: a 4-digit PIN has only 10,000
// possibilities, so the hash alone can never be the defence. Two things carry
// it instead:
//
//   1. LOCKOUT is primary. Consecutive wrong PINs lock the PIN with an
//      escalating delay, so an online guesser gets a handful of tries, not
//      10,000. This is the control that actually matters.
//   2. scrypt is secondary, and defends the OFFLINE case — a leaked database.
//      Cost is kept moderate (N=16384) on purpose: this runs on the hot path
//      of every payment, and a slower KDF would buy little against a 10^4
//      keyspace while taxing every honest transaction.
//
// Never log a PIN, and never put one in a request body — see readPin().

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { ensureTransactionPinColumns } from "./ensureTransactionPin";
import { isTransactionPinRequired } from "./settings";

// promisify picks scrypt's 4-argument overload, which drops the cost options.
// Name the signature we actually use so N/r/p type-check.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** PIN shape. Four digits is the Nigerian banking norm; six is allowed. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

// scrypt cost. Encoded into the stored string so these can be raised later
// without invalidating existing PINs — verify reads the params it was hashed
// with, and a PIN re-hashes on the next successful change.
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Wrong PINs tolerated before the PIN locks. */
const FAILURES_BEFORE_LOCK = 5;

/**
 * Lockout ladder. Each further block of failures locks for longer, so a
 * guesser is spending hours per handful of attempts while a user who simply
 * misremembered waits minutes.
 */
function lockDurationMs(failures: number): number {
  if (failures >= 15) return 24 * 60 * 60 * 1000; // a day
  if (failures >= 10) return 60 * 60 * 1000; // an hour
  return 15 * 60 * 1000; // a quarter of an hour
}

// ---- PIN strength ---------------------------------------------------------

/**
 * PINs an attacker tries first. Structural rules below catch most weak PINs
 * (repeats, runs); this list covers the ones with cultural rather than
 * numeric patterns — keypad shapes and years.
 */
const BANNED_PINS = new Set([
  "1234", "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777",
  "8888", "9999", "1212", "6969", "1004", "2000", "2001", "1122", "1313",
  "2580", "0852", "1010", "4321", "1590", "0110", "1379", "2468", "1357",
  "123456", "654321", "111111", "000000", "121212", "112233", "123123",
  "159753", "147258", "102030",
]);

function isAllSameDigit(pin: string): boolean {
  return new Set(pin).size === 1;
}

/** 1234 / 3456 — each digit one more than the last. Also catches wraps (8901). */
function isAscendingRun(pin: string): boolean {
  for (let i = 1; i < pin.length; i++) {
    if ((Number(pin[i - 1]) + 1) % 10 !== Number(pin[i])) return false;
  }
  return true;
}

function isDescendingRun(pin: string): boolean {
  for (let i = 1; i < pin.length; i++) {
    if ((Number(pin[i - 1]) + 9) % 10 !== Number(pin[i])) return false;
  }
  return true;
}

/**
 * Reject a PIN that is not worth the protection it implies. Throws a 422 the
 * UI can show verbatim — each message says what to change, because "invalid
 * PIN" with no reason makes people try another weak one.
 */
export function assertPinStrength(pin: string): void {
  if (!/^\d+$/.test(pin)) {
    throw new ApiError(422, "Your PIN must be digits only.", "pin_not_numeric");
  }
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new ApiError(
      422,
      `Your PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits.`,
      "pin_bad_length",
    );
  }
  if (isAllSameDigit(pin)) {
    throw new ApiError(
      422,
      "Your PIN can't be the same digit repeated. Please choose another.",
      "pin_too_weak",
    );
  }
  if (isAscendingRun(pin) || isDescendingRun(pin)) {
    throw new ApiError(
      422,
      "Your PIN can't be a run of consecutive digits. Please choose another.",
      "pin_too_weak",
    );
  }
  if (BANNED_PINS.has(pin)) {
    throw new ApiError(
      422,
      "That PIN is one of the most commonly guessed. Please choose another.",
      "pin_too_weak",
    );
  }
}

// ---- Hashing --------------------------------------------------------------

/**
 * Hash a PIN for storage. Self-describing format so the cost parameters can
 * change without a migration:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<key base64>
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = (await scryptAsync(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  }));
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Check a PIN against a stored hash in constant time.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt
 * hash must read as "wrong PIN" and never as "authorised".
 */
export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scryptAsync(pin, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which would itself leak a bit.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---- The gate -------------------------------------------------------------

/**
 * Where the PIN travels: a header, never the JSON body.
 *
 * This is not arbitrary. Several money routes spread parts of the request body
 * into `transaction.metadata` (the transfer note, for one), so a `pin` field in
 * the body is one careless spread away from being written to a database row
 * and read by anyone with table access. A header cannot be swept into a
 * payload by accident.
 */
export const PIN_HEADER = "x-transaction-pin";

export function readPin(req: Request): string | null {
  const raw = req.headers.get(PIN_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface PinStatus {
  isSet: boolean;
  lockedUntil: Date | null;
  /** Attempts left before the PIN locks. Null when it is already locked. */
  attemptsRemaining: number | null;
}

/** What the settings screen needs to render, without revealing anything. */
export async function getPinStatus(userId: string): Promise<PinStatus> {
  await ensureTransactionPinColumns();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      transactionPinHash: true,
      transactionPinFailures: true,
      transactionPinLockedUntil: true,
    },
  });
  const lockedUntil =
    user?.transactionPinLockedUntil && user.transactionPinLockedUntil > new Date()
      ? user.transactionPinLockedUntil
      : null;
  return {
    isSet: Boolean(user?.transactionPinHash),
    lockedUntil,
    attemptsRemaining: lockedUntil
      ? null
      : Math.max(0, FAILURES_BEFORE_LOCK - (user?.transactionPinFailures ?? 0)),
  };
}

function lockedError(until: Date): ApiError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  const wait =
    minutes >= 60
      ? `${Math.ceil(minutes / 60)} hour${minutes >= 120 ? "s" : ""}`
      : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return new ApiError(
    423,
    `Too many incorrect PIN attempts. Try again in about ${wait}, or reset your PIN from Settings.`,
    "pin_locked",
  );
}

/**
 * The gate every money route calls BEFORE it moves anything.
 *
 * Throws on any outcome but a correct PIN, so a route that calls this and then
 * proceeds is authorised by construction. Callers must place it before the
 * first write AND before the idempotency key is claimed — a wrong PIN must
 * leave no transaction row and must not burn the caller's key, or a user who
 * fat-fingers their PIN could never retry that payment.
 *
 * Failure accounting is committed even though this throws: the increment runs
 * as its own write, not inside the caller's transaction, so a rejected attempt
 * still counts toward the lockout.
 *
 * Rollout: a user with NO PIN is refused only once the platform switch is on
 * (see isTransactionPinRequired). A user who HAS a PIN is always verified, so
 * opting in protects you the moment you set one rather than the moment the
 * business flips the switch. `enforce` overrides the switch for flows that are
 * meaningless without a PIN — changing one, for instance.
 */
export async function requireTransactionPin(
  userId: string,
  pin: string | null,
  opts: { enforce?: boolean } = {},
): Promise<void> {
  await ensureTransactionPinColumns();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      transactionPinHash: true,
      transactionPinFailures: true,
      transactionPinLockedUntil: true,
    },
  });

  if (!user?.transactionPinHash) {
    // No PIN on the account. Whether that blocks the payment is a rollout
    // decision, not a security one — there is nothing to verify either way.
    if (opts.enforce || (await isTransactionPinRequired())) {
      throw new ApiError(
        428,
        "Set up your transaction PIN before sending money.",
        "pin_not_set",
      );
    }
    return;
  }

  const now = new Date();
  if (user.transactionPinLockedUntil && user.transactionPinLockedUntil > now) {
    throw lockedError(user.transactionPinLockedUntil);
  }

  if (!pin) {
    throw new ApiError(401, "Enter your transaction PIN to continue.", "pin_required");
  }

  if (await verifyPinHash(pin, user.transactionPinHash)) {
    // Only write when there is something to clear — the common path stays a
    // single read.
    if (user.transactionPinFailures > 0 || user.transactionPinLockedUntil) {
      await prisma.user.update({
        where: { id: userId },
        data: { transactionPinFailures: 0, transactionPinLockedUntil: null },
      });
    }
    return;
  }

  // Wrong PIN. Count it, and lock once the run is long enough.
  const failures = user.transactionPinFailures + 1;
  const shouldLock = failures >= FAILURES_BEFORE_LOCK;
  const until = shouldLock ? new Date(now.getTime() + lockDurationMs(failures)) : null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      transactionPinFailures: failures,
      ...(until ? { transactionPinLockedUntil: until } : {}),
    },
  });

  if (until) throw lockedError(until);

  const left = FAILURES_BEFORE_LOCK - failures;
  throw new ApiError(
    401,
    `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left before your PIN is locked.`,
    "pin_incorrect",
  );
}

/** Set a PIN for the first time, or replace one after a verified change. */
export async function setTransactionPin(userId: string, pin: string): Promise<void> {
  assertPinStrength(pin);
  await ensureTransactionPinColumns();
  const hash = await hashPin(pin);
  await prisma.user.update({
    where: { id: userId },
    data: {
      transactionPinHash: hash,
      transactionPinSetAt: new Date(),
      transactionPinFailures: 0,
      transactionPinLockedUntil: null,
    },
  });
}
