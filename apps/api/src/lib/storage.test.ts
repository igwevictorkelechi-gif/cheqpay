import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureKycBucket,
  kycDocumentOwner,
  moveKycDocument,
  signKycDocument,
  uploadKycDocument,
} from "./storage";

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

  it("makes both lifecycle folders visible even while they are empty", async () => {
    const calls = stub(() => new Response(null, { status: 200 }));
    await ensureKycBucket();
    const placeholders = calls.filter((c) => c.url.includes(".emptyFolderPlaceholder"));
    expect(placeholders.map((c) => c.url)).toEqual([
      `${URL_BASE}/storage/v1/object/kyc-documents/kyc/pending/.emptyFolderPlaceholder`,
      `${URL_BASE}/storage/v1/object/kyc-documents/kyc/submitted/.emptyFolderPlaceholder`,
    ]);
  });

  it("a folder placeholder that cannot be written is not an error", async () => {
    stub((url) =>
      url.includes(".emptyFolderPlaceholder")
        ? new Response("nope", { status: 500 })
        : new Response(null, { status: 200 })
    );
    await expect(ensureKycBucket()).resolves.toBeUndefined();
  });

  it("uploads into the pending staging folder and returns the path", async () => {
    const calls = stub((url) => {
      if (url.endsWith("/bucket")) return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ Key: "ok" }), { status: 200 });
    });
    const ref = await uploadKycDocument("user-42", Buffer.from("imgbytes"), "image/png");
    expect(ref).toMatch(/^kyc\/pending\/user-42\/[0-9a-f-]+\.png$/);
    const put = calls.find((c) =>
      c.url.includes("/object/kyc-documents/kyc/pending/user-42/")
    )!;
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

  describe("promoting a document out of staging", () => {
    it("moves a pending object to the submitted folder", async () => {
      const calls = stub(() => new Response(JSON.stringify({ message: "Successfully moved" })));
      const moved = await moveKycDocument("kyc/pending/u1/a.jpg");
      expect(moved).toBe("kyc/submitted/u1/a.jpg");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${URL_BASE}/storage/v1/object/move`);
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        bucketId: "kyc-documents",
        sourceKey: "kyc/pending/u1/a.jpg",
        destinationKey: "kyc/submitted/u1/a.jpg",
      });
    });

    it("leaves an already-submitted object alone", async () => {
      const calls = stub(() => new Response(null, { status: 500 }));
      await expect(moveKycDocument("kyc/submitted/u1/a.jpg")).resolves.toBe(
        "kyc/submitted/u1/a.jpg"
      );
      expect(calls).toHaveLength(0);
    });

    it("leaves a document uploaded before staging existed where it is", async () => {
      const calls = stub(() => new Response(null, { status: 500 }));
      await expect(moveKycDocument("kyc/u1/a.jpg")).resolves.toBe("kyc/u1/a.jpg");
      expect(calls).toHaveLength(0);
    });
  });

  describe("signing survives a ref that is out of step with storage", () => {
    it("falls back to the submitted copy when the pending path is gone", async () => {
      const calls = stub((url) =>
        url.includes("/kyc/submitted/u1/a.jpg")
          ? new Response(
              JSON.stringify({ signedURL: "/object/sign/kyc-documents/kyc/submitted/u1/a.jpg?t=1" })
            )
          : new Response("Object not found", { status: 404 })
      );
      const url = await signKycDocument("kyc/pending/u1/a.jpg", 600);
      expect(url).toBe(
        `${URL_BASE}/storage/v1/object/sign/kyc-documents/kyc/submitted/u1/a.jpg?t=1`
      );
      expect(calls).toHaveLength(2);
    });

    it("reports the original failure when neither copy exists", async () => {
      stub(() => new Response("Object not found", { status: 404 }));
      await expect(signKycDocument("kyc/pending/u1/a.jpg", 600)).rejects.toThrow(/404/);
    });

    it("does not retry a legacy path that has no counterpart", async () => {
      const calls = stub(() => new Response("Object not found", { status: 404 }));
      await expect(signKycDocument("kyc/u1/a.jpg", 600)).rejects.toThrow(/404/);
      expect(calls).toHaveLength(1);
    });
  });
  describe("reading the owner out of a ref", () => {
    it.each([
      ["kyc/pending/u1/a.jpg", "u1"],
      ["kyc/submitted/u1/a.jpg", "u1"],
      ["kyc/u1/a.jpg", "u1"],
    ])("%s belongs to %s", (ref, owner) => {
      expect(kycDocumentOwner(ref)).toBe(owner);
    });

    it.each([
      "kyc/pending/u1/nested/a.jpg",
      "kyc/pending/u1/../u2/a.jpg",
      "kyc/pending/u1/",
      "kyc/a.jpg",
      "other-bucket/u1/a.jpg",
      "",
    ])("rejects %s", (ref) => {
      expect(kycDocumentOwner(ref)).toBeNull();
    });
  });
});
