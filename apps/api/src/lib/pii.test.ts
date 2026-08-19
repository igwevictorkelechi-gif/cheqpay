import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRetainedIdentity,
  decryptPii,
  encryptPii,
  fingerprintMatches,
  fingerprintPii,
  isPiiEncryptionConfigured,
  last4,
  piiKeyStatus,
  resetPiiKeyCache,
} from "./pii";

// A fixed 32-byte key so the tests are deterministic.
const KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = KEY;
  resetPiiKeyCache();
});

describe("encryptPii / decryptPii", () => {
  it("round-trips a BVN", () => {
    const bvn = "22123456789";
    expect(decryptPii(encryptPii(bvn))).toBe(bvn);
  });

  it("produces different ciphertext each time", () => {
    // A fresh IV per call. This is why lookup needs a separate fingerprint —
    // you cannot find a row by matching its ciphertext.
    const a = encryptPii("22123456789");
    const b = encryptPii("22123456789");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("never contains the plaintext", () => {
    expect(encryptPii("22123456789")).not.toContain("22123456789");
  });

  it("rejects tampered ciphertext rather than returning garbage", () => {
    const enc = encryptPii("22123456789");
    const parts = enc.split(":");
    // Flip the last character of the ciphertext segment.
    const ct = Buffer.from(parts[3], "base64");
    ct[ct.length - 1] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptPii(parts.join(":"))).toThrow();
  });

  it("rejects an unrecognized format", () => {
    expect(() => decryptPii("not-a-ciphertext")).toThrow(/format/i);
  });
});

describe("fingerprintPii", () => {
  it("is deterministic, so it can be indexed and matched", () => {
    expect(fingerprintPii("22123456789")).toBe(fingerprintPii("22123456789"));
  });

  it("ignores surrounding whitespace", () => {
    expect(fingerprintPii(" 22123456789 ")).toBe(fingerprintPii("22123456789"));
  });

  it("differs for different BVNs", () => {
    expect(fingerprintPii("22123456789")).not.toBe(fingerprintPii("22123456780"));
  });

  it("does not reveal the plaintext", () => {
    expect(fingerprintPii("22123456789")).not.toContain("22123456789");
  });

  it("changes with the key, so a stolen database alone cannot be searched", () => {
    const withKeyA = fingerprintPii("22123456789");
    process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    resetPiiKeyCache();
    expect(fingerprintPii("22123456789")).not.toBe(withKeyA);
  });

  it("compares safely", () => {
    const f = fingerprintPii("22123456789");
    expect(fingerprintMatches(f, f)).toBe(true);
    expect(fingerprintMatches(f, fingerprintPii("22123456780"))).toBe(false);
    expect(fingerprintMatches(f, "abcd")).toBe(false);
  });
});

describe("key handling", () => {
  it("reports whether encryption is configured", () => {
    expect(isPiiEncryptionConfigured()).toBe(true);
    delete process.env.PII_ENCRYPTION_KEY;
    resetPiiKeyCache();
    expect(isPiiEncryptionConfigured()).toBe(false);
  });

  it("tells a missing key apart from an unusable one", () => {
    // The two need opposite fixes — generate one, versus replace the one you
    // generated wrongly — so a single boolean cannot express the situation.
    delete process.env.PII_ENCRYPTION_KEY;
    resetPiiKeyCache();
    expect(piiKeyStatus()).toBe("unset");

    process.env.PII_ENCRYPTION_KEY = "   ";
    resetPiiKeyCache();
    expect(piiKeyStatus()).toBe("unset");

    process.env.PII_ENCRYPTION_KEY = KEY;
    resetPiiKeyCache();
    expect(piiKeyStatus()).toBe("ok");
  });

  it("rejects a 32-CHARACTER key, which is the natural mistake", () => {
    // "any 32+ character random string" is wrong and decodes to 24 bytes. The
    // requirement is base64 decoding to 32 bytes — 44 characters from
    // `openssl rand -base64 32`.
    const thirtyTwoChars = "abcdefghijklmnopqrstuvwxyz012345";
    expect(thirtyTwoChars).toHaveLength(32);
    expect(Buffer.from(thirtyTwoChars, "base64")).toHaveLength(24);

    process.env.PII_ENCRYPTION_KEY = thirtyTwoChars;
    resetPiiKeyCache();
    expect(piiKeyStatus()).toBe("invalid");
    // The whole point: callers branch on this, so it must not claim to be ready.
    expect(isPiiEncryptionConfigured()).toBe(false);
  });

  it("accepts what the documented command actually produces", () => {
    // 32 random bytes → 44 base64 characters. Generated here rather than
    // hard-coded so the test exercises real output shape.
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(process.env.PII_ENCRYPTION_KEY).toHaveLength(44);
    resetPiiKeyCache();
    expect(piiKeyStatus()).toBe("ok");
    expect(decryptPii(encryptPii("22123456789"))).toBe("22123456789");
  });

  it("never throws while classifying, however mangled the value", () => {
    for (const bad of ["!!!!", "=", "a", "𝔲𝔫𝔦𝔠𝔬𝔡𝔢", "-".repeat(100)]) {
      process.env.PII_ENCRYPTION_KEY = bad;
      resetPiiKeyCache();
      expect(() => piiKeyStatus()).not.toThrow();
      expect(piiKeyStatus()).not.toBe("ok");
    }
  });

  it("refuses to operate without a key rather than storing recoverable data", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    resetPiiKeyCache();
    expect(() => encryptPii("22123456789")).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.PII_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    resetPiiKeyCache();
    expect(() => encryptPii("x")).toThrow(/32 bytes/);
  });
});

describe("last4", () => {
  it("takes the final four digits", () => {
    expect(last4("22123456789")).toBe("6789");
  });

  it("ignores non-digits", () => {
    expect(last4("221-234-567-89")).toBe("6789");
  });

  it("returns empty when there is too little to show", () => {
    expect(last4("12")).toBe("");
  });
});

/**
 * The legal name must survive any key problem.
 *
 * It shares no dependency with the key, but used to share a try block with the
 * encryption, so an unusable key threw before the database write and lost both.
 * An account with a BVN we could not store is a compliance gap; an account with
 * no name attached is one an investigation cannot answer at all.
 */
describe("buildRetainedIdentity", () => {
  it("retains name and BVN when the key is good", () => {
    const { identity, problem } = buildRetainedIdentity({
      legalName: "Ada Obi",
      bvn: "22123456789",
    });
    expect(problem).toBeNull();
    expect(identity.legalName).toBe("Ada Obi");
    expect(identity.bvnLast4).toBe("6789");
    expect(decryptPii(identity.bvnCiphertext!)).toBe("22123456789");
    expect(identity.bvnFingerprint).toBe(fingerprintPii("22123456789"));
  });

  it("keeps the name when the key is missing", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    resetPiiKeyCache();
    const { identity, problem } = buildRetainedIdentity({
      legalName: "Ada Obi",
      bvn: "22123456789",
    });
    expect(identity.legalName).toBe("Ada Obi");
    expect(identity.bvnCiphertext).toBeUndefined();
    expect(problem).toMatch(/not set/);
  });

  it("keeps the name when the key is unusable, and says which problem it is", () => {
    process.env.PII_ENCRYPTION_KEY = "abcdefghijklmnopqrstuvwxyz012345"; // 24 bytes
    resetPiiKeyCache();
    const { identity, problem } = buildRetainedIdentity({
      legalName: "Ada Obi",
      bvn: "22123456789",
    });
    expect(identity.legalName).toBe("Ada Obi");
    expect(identity.bvnCiphertext).toBeUndefined();
    // Distinguishable from "not set" — the fix is different.
    expect(problem).toMatch(/unusable/);
    expect(problem).toMatch(/openssl rand -base64 32/);
  });

  it("never throws, whatever the key is", () => {
    for (const bad of [undefined, "", "!!!", "a".repeat(10)]) {
      if (bad === undefined) delete process.env.PII_ENCRYPTION_KEY;
      else process.env.PII_ENCRYPTION_KEY = bad;
      resetPiiKeyCache();
      expect(() => buildRetainedIdentity({ legalName: "Ada Obi", bvn: "22123456789" })).not.toThrow();
    }
  });

  it("reports no problem when there was no BVN to retain", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    resetPiiKeyCache();
    const { identity, problem } = buildRetainedIdentity({ legalName: "Ada Obi" });
    expect(problem).toBeNull();
    expect(identity).toEqual({ legalName: "Ada Obi" });
  });
});
