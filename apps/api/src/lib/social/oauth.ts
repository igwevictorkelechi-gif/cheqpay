// apps/api/src/lib/social/oauth.ts
//
// The connect flow. An admin asks to connect (section-guarded), we store a
// single-use state row holding who asked, where to send them back and — for
// PKCE providers — the code verifier, and hand back the platform's login URL.
// The platform redirects to our PUBLIC callback, which can only finish a flow
// whose state exists, is unexpired, matches the platform, and is consumed
// atomically, so a forged or replayed callback connects nothing.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { getEnv } from "../env";
import { ApiError } from "../http";
import { PROVIDERS } from "./providers";
import type { ProviderId } from "./providers/types";
import { ensureSocialSchema } from "./schema";

const STATE_TTL_MIN = 10;

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function callbackUrl(provider: ProviderId): string {
  const base = getEnv().API_PUBLIC_URL;
  if (!base) throw new ApiError(503, "API_PUBLIC_URL isn't set, so platforms have nowhere to send you back to.", "no_public_url");
  return `${base.replace(/\/+$/, "")}/api/social/oauth/${provider}/callback`;
}

/** Only send people back to an https dashboard origin (or localhost in development). */
export function safeReturnUrl(origin: string | null): string {
  if (!origin) throw new ApiError(400, "Couldn't tell which dashboard to return to.", "no_return_url");
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new ApiError(400, "Invalid dashboard origin.", "bad_return_url");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production")) {
    throw new ApiError(400, "The dashboard must be served over https.", "bad_return_url");
  }
  return `${u.origin}/social/accounts`;
}

export async function startConnect(provider: ProviderId, actor: string, returnUrl: string): Promise<string> {
  const p = PROVIDERS[provider];
  if (!p.configured()) {
    throw new ApiError(409, `${p.label} isn't set up yet: its app keys are missing on the server.`, "provider_unconfigured");
  }
  await ensureSocialSchema();
  const state = b64url(randomBytes(32));
  const pkce = p.usesPkce ? pkcePair() : null;
  await prisma.$executeRaw`DELETE FROM social_oauth_states WHERE expires_at < now()`;
  await prisma.$executeRaw`
    INSERT INTO social_oauth_states (state, platform, code_verifier, actor, return_url, expires_at)
    VALUES (${state}, ${provider}, ${pkce?.verifier ?? null}, ${actor}, ${returnUrl}, now() + make_interval(mins => ${STATE_TTL_MIN}))`;
  return p.authorizeUrl({ state, redirectUri: callbackUrl(provider), codeChallenge: pkce?.challenge });
}

/** Consume a state row: returns it once, then never again. */
export async function consumeState(
  provider: ProviderId,
  state: string,
): Promise<{ actor: string; returnUrl: string; codeVerifier: string | null } | null> {
  await ensureSocialSchema();
  const rows = await prisma.$queryRaw<{ actor: string; return_url: string; code_verifier: string | null }[]>`
    DELETE FROM social_oauth_states
    WHERE state = ${state} AND platform = ${provider} AND expires_at > now()
    RETURNING actor, return_url, code_verifier`;
  const r = rows[0];
  return r ? { actor: r.actor, returnUrl: r.return_url, codeVerifier: r.code_verifier } : null;
}
