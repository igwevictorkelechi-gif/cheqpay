// apps/api/src/lib/supabaseAdmin.ts
//
// Where and how to reach the Supabase Admin API (service role). Used to mint
// "Continue with CheqPay" sign-in tokens and to delete the auth user when an
// account is closed.
//
// The project URL is public, so it falls back to the same project the rest of
// the API validates tokens against (lib/auth.ts) — only the secret key has to
// be configured. Without SUPABASE_SERVICE_ROLE_KEY both features refuse, and
// that is announced once per instance so the gap shows in the runtime logs.

const DEFAULT_SUPABASE_URL = "https://xttgnswgeffyybjfjlkp.supabase.co";

let warned = false;

export function supabaseAdminConfig(env: Record<string, string | undefined> = process.env): { url: string; key: string } | null {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    if (!warned) {
      warned = true;
      console.error(
        "[supabase-admin] SUPABASE_SERVICE_ROLE_KEY is not set: Continue with CheqPay and account closure are unavailable",
      );
    }
    return null;
  }
  return { url, key };
}
