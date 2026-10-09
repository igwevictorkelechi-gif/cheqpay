import { describe, expect, it } from "vitest";
import { supabaseAdminConfig } from "./supabaseAdmin";

// Sign in with CheqPay and account closure both need the Supabase Admin API.
// Only the secret key should have to be configured: the URL is public.
describe("supabase admin config", () => {
  it("needs the service-role key", () => {
    expect(supabaseAdminConfig({})).toBeNull();
    expect(supabaseAdminConfig({ SUPABASE_SERVICE_ROLE_KEY: "  " })).toBeNull();
  });

  it("falls back to the project URL the API already validates tokens against", () => {
    expect(supabaseAdminConfig({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toEqual({ url: "https://xttgnswgeffyybjfjlkp.supabase.co", key: "k" });
    expect(supabaseAdminConfig({ SUPABASE_SERVICE_ROLE_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co" })?.url).toBe("https://a.supabase.co");
    expect(supabaseAdminConfig({ SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_URL: "https://b.supabase.co/", NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co" })?.url).toBe("https://b.supabase.co");
  });
});
