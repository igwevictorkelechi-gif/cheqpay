import { describe, expect, it } from "vitest";
import { allowedOrigins, corsHeaders } from "./middleware";

describe("CORS", () => {
  const allow = allowedOrigins({ NODE_ENV: "production" });

  it("answers the CheqPay sites", () => {
    for (const o of ["https://mycheqpay.com", "https://www.mycheqpay.com", "https://cheqpay.vercel.app"]) {
      expect(corsHeaders(o, allow)["Access-Control-Allow-Origin"]).toBe(o);
    }
  });

  it("never reflects any other origin", () => {
    expect(corsHeaders("https://evil.example", allow)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(null, allow)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("http://localhost:3000", allow)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows the methods and headers the web app sends, and not the admin ones", () => {
    const h = corsHeaders("https://mycheqpay.com", allow);
    expect(h["Access-Control-Allow-Methods"]).toContain("PATCH");
    expect(h["Access-Control-Allow-Methods"]).toContain("DELETE");
    expect(h["Access-Control-Allow-Headers"]).toContain("x-transaction-pin");
    expect(h["Access-Control-Allow-Headers"]).not.toContain("x-admin");
  });

  it("adds origins from ALLOWED_ORIGINS", () => {
    const a = allowedOrigins({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://staging.mycheqpay.com/" });
    expect(corsHeaders("https://staging.mycheqpay.com", a)["Access-Control-Allow-Origin"]).toBe(
      "https://staging.mycheqpay.com",
    );
  });
});
