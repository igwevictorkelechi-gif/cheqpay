import { createClient } from "@supabase/supabase-js";
import { clearUserCaches } from "@/lib/cache";

// CheqPay Supabase project. The anon key is a public client key (protected by
// Row Level Security), so it is safe to ship in the bundle. Env vars override
// these defaults when set.
const DEFAULT_URL = "https://xttgnswgeffyybjfjlkp.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dGduc3dnZWZmeXliamZqbGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjIzMzMsImV4cCI6MjA5MjAzODMzM30.RWUrrTINfqPJ_H6vbFtLZ7uf0okWb5gUYJy9LK9NlCQ";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});

// However a session ends — the sign-out button, a blocked account, a refresh
// token that stopped working, another tab signing out — wipe what this browser
// cached about the user and stop its notifications, so the next person to use
// this device never sees their balance, history, deposit address or alerts.
// When someone signs in (or comes back signed in), keep this browser's
// notifications going for them if they've allowed them before.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
      // Loaded lazily: the push helpers use the API client, which uses this file.
      void import("@/lib/webPush").then((m) => m.resyncPush()).catch(() => undefined);
      return;
    }
    if (event !== "SIGNED_OUT") return;
    clearUserCaches();
    void import("@/lib/webPush").then((m) => m.resetPushResync()).catch(() => undefined);
    // Stop this browser receiving the signed-out user's notifications, and tell
    // the API so it stops counting it. The session is already gone, so the
    // browser proves it owns the subscription with its auth secret instead.
    void navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then(async (sub) => {
        if (!sub) return;
        const auth = sub.toJSON().keys?.auth;
        if (auth) {
          const { API_BASE } = await import("@/services/api");
          await fetch(`${API_BASE}/api/push/web/unsubscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint, auth }),
            keepalive: true,
          }).catch(() => undefined);
        }
        await sub.unsubscribe();
      })
      .catch(() => undefined);
  });
}
