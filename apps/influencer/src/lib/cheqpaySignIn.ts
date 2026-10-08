// "Continue with CheqPay": sign in on mycheqpay.com and come back signed in.
//
// The verifier never leaves this browser tab (sessionStorage); mycheqpay.com
// only ever sees its hash. The one-time code that comes back is useless
// without it, so a leaked or planted code can't sign anyone in.

import { API_BASE } from "./api";
import { supabase } from "./supabase";

export const CHEQPAY_WEB = "https://mycheqpay.com";
const KEY = "cheqpay-creators-sso";
const MAX_AGE_MS = 2 * 60 * 60_000; // long enough to sign up and verify on CheqPay first

function random(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function s256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A path on this site to land on afterwards, or the dashboard. */
export function safeNext(raw: string | null | undefined): string {
  const s = raw ?? "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/dashboard";
}

/** Leave for mycheqpay.com to sign in there; come back to `next`. */
export async function startCheqPaySignIn(next: string): Promise<void> {
  const state = random(24);
  const verifier = random(48);
  sessionStorage.setItem(KEY, JSON.stringify({ state, verifier, next: safeNext(next), at: Date.now() }));
  const q = new URLSearchParams({ client: "creators", state, challenge: await s256(verifier) });
  window.location.assign(`${CHEQPAY_WEB}/connect/?${q}`);
}

export class SignInError extends Error {}

/** Finish on the callback page: swap the code for a session here. Returns where to go next. */
export async function finishCheqPaySignIn(code: string | null, state: string | null): Promise<string> {
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  let saved: { state?: string; verifier?: string; next?: string; at?: number } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    /* treated as missing below */
  }
  if (!code || !state || !saved.verifier || saved.state !== state || typeof saved.at !== "number" || Date.now() - saved.at > MAX_AGE_MS) {
    throw new SignInError("This sign-in didn't start here, or took too long. Please try again.");
  }
  const res = await fetch(`${API_BASE}/api/sso/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "creators", code, verifier: saved.verifier }),
  });
  const body = (await res.json().catch(() => null)) as { token_hash?: string; error?: string } | null;
  if (!res.ok || !body?.token_hash) throw new SignInError(body?.error ?? "We couldn't sign you in. Please try again.");
  const { error } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type: "magiclink" });
  if (error) throw new SignInError("We couldn't sign you in. Please try again.");
  return safeNext(saved.next);
}
