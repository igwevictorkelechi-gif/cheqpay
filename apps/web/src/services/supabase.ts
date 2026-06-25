import { createClient } from "@supabase/supabase-js";

// Cheqpay Supabase project. The anon key is a public client key (protected by
// Row Level Security), so it is safe to ship in the bundle. Env vars override
// these defaults when set.
const DEFAULT_URL = "https://xttgnswgeffyybjfjlkp.supabase.co";
const DEFAULT_ANON_KEY = "REPLACE_WITH_ANON_KEY";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});
