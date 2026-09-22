import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { readPayloadHash, verifyTatumSignature } from "./webhook";

const SECRET = "s3cr3t-webhook-key";
const BODY = JSON.stringify({ address: "0xabc", amount: "25", chain: "bsc-mainnet", txId: "0x1" });

function sign(algo: "sha512" | "sha256", enc: "base64" | "hex", body = BODY, secret = SECRET) {
  return createHmac(algo, secret).update(body, "utf8").digest(enc);
}

afterEach(() => {
  delete process.env.TATUM_WEBHOOK_SECRET;
});

describe("verifyTatumSignature", () => {
  it("accepts every HMAC variant Tatum ships", () => {
    process.env.TATUM_WEBHOOK_SECRET = SECRET;
    for (const algo of ["sha512", "sha256"] as const) {
      for (const enc of ["base64", "hex"] as const) {
        expect(verifyTatumSignature(BODY, sign(algo, enc))).toBe(true);
      }
    }
  });

  it("fails closed when no secret is configured", () => {
    // An unauthenticated endpoint that credits balances is not something to
    // fail open on, even with a digest that would otherwise verify.
    expect(verifyTatumSignature(BODY, sign("sha512", "base64"))).toBe(false);
  });

  it("rejects a digest made with the wrong secret", () => {
    process.env.TATUM_WEBHOOK_SECRET = SECRET;
    expect(verifyTatumSignature(BODY, sign("sha512", "base64", BODY, "not-the-secret"))).toBe(false);
  });

  it("rejects a body altered after signing", () => {
    process.env.TATUM_WEBHOOK_SECRET = SECRET;
    const digest = sign("sha512", "base64");
    const tampered = BODY.replace('"25"', '"2500000"');
    expect(verifyTatumSignature(tampered, digest)).toBe(false);
  });

  it("rejects empty and malformed digests", () => {
    process.env.TATUM_WEBHOOK_SECRET = SECRET;
    for (const bad of ["", "   ", "deadbeef", "null"]) {
      expect(verifyTatumSignature(BODY, bad)).toBe(false);
    }
  });

  it("verifies the raw bytes, so re-serializing the body breaks it", () => {
    process.env.TATUM_WEBHOOK_SECRET = SECRET;
    const digest = sign("sha512", "base64");
    // Same object, different bytes — this is why the route must read the body
    // as text before parsing it.
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyTatumSignature(reserialized, digest)).toBe(false);
  });
});

describe("readPayloadHash", () => {
  it("reads the header case-insensitively and trims it", () => {
    expect(readPayloadHash(new Headers({ "x-payload-hash": " abc " }))).toBe("abc");
    expect(readPayloadHash(new Headers({ "X-Payload-Hash": "abc" }))).toBe("abc");
  });

  it("returns null when absent or blank", () => {
    expect(readPayloadHash(new Headers())).toBeNull();
    expect(readPayloadHash(new Headers({ "x-payload-hash": "   " }))).toBeNull();
  });
});
