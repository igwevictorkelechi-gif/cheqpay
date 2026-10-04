import { createClient } from "@supabase/supabase-js";

// The same CheqPay sign-in as the app: one account, one session. The anon key
// is a public client key (Row Level Security protects data).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xttgnswgeffyybjfjlkp.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dGduc3dnZWZmeXliamZqbGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjIzMzMsImV4cCI6MjA5MjAzODMzM30.RWUrrTINfqPJ_H6vbFtLZ7uf0okWb5gUYJy9LK9NlCQ";

export const supabase = createClient(url, anonKey, {
  auth: { autoRefreshToken: true, persistSession: true, storageKey: "cheqpay-influencer-auth" },
});
