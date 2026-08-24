import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { executeRaw, queryRaw, executeRawUnsafe } = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: { $executeRaw: executeRaw, $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe },
}));

import {
  kycDocumentOwner,
  markKycDocumentSubmitted,
  parseKycRef,
  readKycDocument,
  resolveApiOrigin,
  signKycDocumentUrl,
  storeKycDocument,
  verifyKycDocumentToken,
} from "./kycDocuments";
import { resetPiiKeyCache } from "./pii";

const KEY = Buffer.alloc(32, 7).toString("base64");

function req(headers: Record<string, string> = {}, url = "https://api.internal/x"): Request {
  return new Request(url, { headers });
}

describe("KYC document store (Postgres-backed)", () => {
  beforeEach(() => {
    executeRaw.mockReset().mockResolvedValue(1);
    queryRaw.mockReset().mockResolvedValue([]);
    executeRawUnsafe.mockReset().mockResolvedValue(0);
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    vi.stubEnv("PUBLIC_API_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    resetPiiKeyCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPiiKeyCache();
  });

  describe("refs", () => {
    it("stores bytes and returns a kyc/{userId}/{uuid} ref", async () => {
      const ref = await storeKycDocument("user-42", Buffer.from("imgbytes"), "image/png");
      expect(ref).toMatch(/^kyc\/user-42\/[0-9a-f-]{36}$/);
      // The insert carried the bytes as a Buffer (bound to bytea), not a string.
      const values = executeRaw.mock.calls[0].slice(1);
      expect(values).toContain("user-42");
      expect(values).toContain("image/png");
      expect(values.some((v: unknown) => Buffer.isBuffer(v))).toBe(true);
    });

    it.each([
      ["kyc/u1/abc", "u1"],
      ["kyc/u1/def", "u1"],
    ])("%s is owned by %s", (ref, owner) => {
      expect(kycDocumentOwner(ref)).toBe(owner);
      expect(parseKycRef(ref)).toEqual({ userId: owner, docId: ref.split("/")[2] });
    });

    it.each([
      "kyc/u1/nested/a.jpg",
      "kyc/u1/../u2/a.jpg",
      "kyc/u1/",
      "kyc/a.jpg",
      "other/u1/a.jpg",
      "",
    ])("rejects malformed ref %s", (ref) => {
      expect(kycDocumentOwner(ref)).toBeNull();
      expect(parseKycRef(ref)).toBeNull();
    });
  });

  describe("submission flag", () => {
    it("flips submitted_at for a real ref, once", async () => {
      await markKycDocumentSubmitted("kyc/u1/11111111-1111-1111-1111-111111111111");
      expect(executeRaw).toHaveBeenCalledTimes(1);
      const values = executeRaw.mock.calls[0].slice(1);
      expect(values).toContain("11111111-1111-1111-1111-111111111111");
    });

    it("is a no-op for a ref it cannot parse", async () => {
      await markKycDocumentSubmitted("not-a-ref");
      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("reading bytes", () => {
    it("returns the row's content type and bytes", async () => {
      queryRaw.mockResolvedValueOnce([{ content_type: "image/jpeg", data: Buffer.from("xy") }]);
      const doc = await readKycDocument("id-1");
      expect(doc).toEqual({ contentType: "image/jpeg", data: Buffer.from("xy") });
    });

    it("returns null when there is no such document", async () => {
      queryRaw.mockResolvedValueOnce([]);
      expect(await readKycDocument("missing")).toBeNull();
    });
  });

  describe("signed URLs", () => {
    it("mints an absolute URL whose token verifies", () => {
      const url = signKycDocumentUrl("kyc/u1/doc-9", 600, "https://api.example.com");
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe("https://api.example.com/api/kyc/documents/doc-9");
      const exp = Number(u.searchParams.get("exp"));
      const sig = u.searchParams.get("sig")!;
      expect(verifyKycDocumentToken("doc-9", exp, sig)).toBe(true);
    });

    it("rejects a tampered document id, a tampered signature and an expired token", () => {
      const url = new URL(signKycDocumentUrl("kyc/u1/doc-9", 600, "https://api.example.com"));
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig")!;
      expect(verifyKycDocumentToken("doc-OTHER", exp, sig)).toBe(false);
      expect(verifyKycDocumentToken("doc-9", exp, sig.replace(/.$/, "0"))).toBe(false);
      expect(verifyKycDocumentToken("doc-9", Math.floor(Date.now() / 1000) - 1, sig)).toBe(false);
    });

    it("cannot be verified once the signing key is gone", () => {
      const url = new URL(signKycDocumentUrl("kyc/u1/doc-9", 600, "https://api.example.com"));
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig")!;
      vi.stubEnv("PII_ENCRYPTION_KEY", "");
      resetPiiKeyCache();
      expect(verifyKycDocumentToken("doc-9", exp, sig)).toBe(false);
    });
  });

  describe("origin resolution", () => {
    it("prefers PUBLIC_API_URL", () => {
      vi.stubEnv("PUBLIC_API_URL", "https://api.mycheqpay.com/");
      expect(resolveApiOrigin(req())).toBe("https://api.mycheqpay.com");
    });
    it("falls back to the Vercel production URL", () => {
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "cheqpay-admin453.vercel.app");
      expect(resolveApiOrigin(req())).toBe("https://cheqpay-admin453.vercel.app");
    });
    it("finally derives from the forwarded host", () => {
      expect(
        resolveApiOrigin(req({ "x-forwarded-proto": "https", "x-forwarded-host": "h.example" }))
      ).toBe("https://h.example");
    });
  });
});
