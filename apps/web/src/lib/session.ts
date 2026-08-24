/**
 * Is there a Supabase session in this browser?
 *
 * A synchronous, best-effort answer. `supabase.auth.getSession()` is async, and
 * the home route has to decide what to render on the very first paint — waiting
 * for a promise there is what produced the blank screen this replaces.
 *
 * Supabase persists its session under a `sb-<project-ref>-auth-token` key in
 * localStorage, so the presence of that key means "this browser has signed in".
 * It deliberately does NOT validate the token: an expired session still renders
 * the dashboard, and the real check inside the app then bounces the user to
 * /login. Getting that wrong costs a redirect; getting the blocking version
 * wrong costs an empty homepage, which is what search engines were indexing.
 */
export function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) return true;
    }
  } catch {
    // Private mode / blocked storage — treat as signed out and let the app's
    // own auth check take over.
  }
  return false;
}
