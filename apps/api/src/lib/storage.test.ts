import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureKycBucket, signKycDocument, uploadKycDocument } from "./storage";

const URL_BASE = "https://proj.supabase.co";

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return calls;
}

describe("KYC document storage", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", URL_BASE);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws a clear error when Supabase is not configured", async () => {
    vi.unstubAllEnvs();
    await expect(uploadKycDocument("u1", Buffer.from("x"), "image/jpeg")).rejects.toThrow(
      /not configured/i
    );
  });

  it("creates the bucket as private and tolerates 'already exists'", async () => {
    const calls = stub(() => new Response("duplicate: already exists", { status: 409 }));
    await expect(ensureKycBucket()).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${URL_BASE}/storage/v1/bucket`);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      id: "kyc-documents",
      public: false,
    });
  });

  it("uploads under kyc/{userId}/ with the service key and returns the path", async () => {
    const calls = stub((url) => {
      if (url.endsWith("/bucket")) return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ Key: "ok" }), { status: 200 });
    });
    const ref = await uploadKycDocument("user-42", Buffer.from("imgbytes"), "image/png");
    expect(ref).toMatch(/^kyc\/user-42\/[0-9a-f-]+\.png$/);
    const put = calls.find((c) => c.url.includes("/object/kyc-documents/kyc/user-42/"))!;
    expect(put.init?.headers).toMatchObject({ Authorization: "Bearer service-key" });
  });

  it("signs a stored object into a full HTTPS URL", async () => {
    const calls = stub(
      () =>
        new Response(
          JSON.stringify({ signedURL: "/object/sign/kyc-documents/kyc/u1/a.jpg?token=xyz" }),
          { status: 200 }
        )
    );
    const url = await signKycDocument("kyc/u1/a.jpg", 3600);
    expect(url).toBe(
      `${URL_BASE}/storage/v1/object/sign/kyc-documents/kyc/u1/a.jpg?token=xyz`
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ expiresIn: 3600 });
  });
});
