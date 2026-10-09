// apps/api/src/lib/sso.ts
//
// "Continue with CheqPay": signing a CheqPay user into one of our other sites
// (today the Creators portal) without a password and without passing tokens
// around in URLs.
//
//   1. The site makes a random verifier, keeps it in the tab, and sends the
//      user to mycheqpay.com/connect with sha256(verifier) as the challenge.
//   2. There, the signed-in user taps Continue; the web app asks us for a
//      handoff code (createHandoff): 256 random bits, stored only as a hash,
//      single use, gone in 60 seconds, bound to the user, the site and the
//      challenge.
//   3. The user lands back on the site's fixed callback URL with the code. The
//      site redeems it with the verifier (redeemHandoff). Only the tab that
//      started the sign-in has the verifier, so an intercepted code is useless
//      and nobody can push their own sign-in into someone else's browser.
//   4. We answer with a one-time Supabase sign-in token (a magic-link token
//      hash minted with the service key), which the site exchanges for its own
//      session. The user's access and refresh tokens never leave the browser
//      that owns them.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { UserStatus, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { supabaseAdminConfig } from "./supabaseAdmin";

/** The sites that may sign users in this way, and the only place each may send them back to. */
export const SSO_CLIENTS = {
  creators: { name: "CheqPay Creators", returnUrl: "https://creator.mycheqpay.com/auth/callback/" },
} as const;
export type SsoClient = keyof typeof SSO_CLIENTS;

export const HANDOFF_TTL_SECONDS = 60;

export function isSsoClient(v: unknown): v is SsoClient {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SSO_CLIENTS, v);
}

/** A PKCE S256 challenge: base64url of a sha256, 43 characters. */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** A PKCE verifier: 43–128 unreserved characters. */
export const VERIFIER = /^[A-Za-z0-9_\-.~]{43,128}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;

export function s256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

let ensured: Promise<void> | null = null;
/** A new table, nothing else selects it, so creating it on first use is safe. */
export function ensureSsoSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS sso_handoffs (
          code_hash  text PRIMARY KEY,
          user_id    uuid NOT NULL,
          email      text NOT NULL,
          client     text NOT NULL,
          challenge  text NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at    timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS sso_handoffs_created_idx ON sso_handoffs (created_at)`);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/** Make a one-time code for a signed-in user. Returns the code (never stored) and where to send them. */
export async function createHandoff(input: {
  userId: string;
  email: string | undefined;
  client: unknown;
  challenge: unknown;
}): Promise<{ code: string; returnUrl: string; expiresIn: number }> {
  if (!isSsoClient(input.client)) throw new ApiError(400, "Unknown site.", "invalid_client");
  if (typeof input.challenge !== "string" || !CHALLENGE.test(input.challenge)) {
    throw new ApiError(400, "This sign-in link is broken. Start again from the site you came from.", "invalid_request");
  }
  if (!input.email) throw new ApiError(400, "Your account has no email address.", "no_email");
  await ensureSsoSchema();
  const code = randomBytes(32).toString("base64url");
  await prisma.$executeRawUnsafe(
    `INSERT INTO sso_handoffs (code_hash, user_id, email, client, challenge, expires_at)
     VALUES ($1, $2::uuid, $3, $4, $5, now() + make_interval(secs => $6::int))`,
    s256(code),
    input.userId,
    input.email.toLowerCase(),
    input.client,
    input.challenge,
    HANDOFF_TTL_SECONDS,
  );
  // Old rows are useless after a minute; sweep now and then.
  if (Math.random() < 0.05) {
    void prisma.$executeRawUnsafe(`DELETE FROM sso_handoffs WHERE created_at < now() - interval '1 day'`).catch(() => undefined);
  }
  return { code, returnUrl: SSO_CLIENTS[input.client].returnUrl, expiresIn: HANDOFF_TTL_SECONDS };
}

const invalidGrant = () =>
  new ApiError(400, "This sign-in has expired or was already used. Please try again.", "invalid_grant");

/**
 * Spend a code: once, before it expires, for the site it was made for, and
 * only with the verifier behind its challenge. The code is burned even when
 * the verifier is wrong, so it can't be guessed against.
 */
export async function redeemHandoff(input: {
  client: unknown;
  code: unknown;
  verifier: unknown;
  mint?: (email: string) => Promise<string>;
}): Promise<{ userId: string; tokenHash: string }> {
  if (!isSsoClient(input.client)) throw new ApiError(400, "Unknown site.", "invalid_client");
  if (typeof input.code !== "string" || !CODE.test(input.code)) throw invalidGrant();
  if (typeof input.verifier !== "string" || !VERIFIER.test(input.verifier)) throw invalidGrant();
  await ensureSsoSchema();
  const rows = await prisma.$queryRawUnsafe<{ user_id: string; email: string; challenge: string }[]>(
    `UPDATE sso_handoffs SET used_at = now()
      WHERE code_hash = $1 AND client = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id, email, challenge`,
    s256(input.code),
    input.client,
  );
  const row = rows[0];
  if (!row) throw invalidGrant();
  const expected = Buffer.from(row.challenge);
  const got = Buffer.from(s256(input.verifier));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw invalidGrant();

  const user = await prisma.user.findUnique({ where: { id: row.user_id }, select: { status: true } });
  if (!user || user.status === UserStatus.BLOCKED || user.status === UserStatus.SUSPENDED) {
    throw new ApiError(403, "This account can't sign in. Contact support@mycheqpay.com.", "account_blocked");
  }
  const tokenHash = await (input.mint ?? mintSignInToken)(row.email);
  return { userId: row.user_id, tokenHash };
}

/**
 * A one-time Supabase sign-in token for this email (the hash half of a magic
 * link). Nothing is emailed: the admin endpoint only generates the link.
 */
export async function mintSignInToken(email: string): Promise<string> {
  const admin = supabaseAdminConfig();
  if (!admin) throw new ApiError(503, "Signing in with CheqPay is unavailable right now.", "sso_not_configured");
  const { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY } = admin;
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "magiclink", email }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[sso] generate_link request failed", err instanceof Error ? err.message : err);
    throw new ApiError(502, "Couldn't finish signing you in. Please try again.", "sso_failed");
  }
  const body = (await res.json().catch(() => null)) as { hashed_token?: string; properties?: { hashed_token?: string } } | null;
  const hashed = body?.hashed_token ?? body?.properties?.hashed_token;
  if (!res.ok || !hashed) {
    console.error(`[sso] generate_link returned ${res.status}`);
    throw new ApiError(502, "Couldn't finish signing you in. Please try again.", "sso_failed");
  }
  return hashed;
}

