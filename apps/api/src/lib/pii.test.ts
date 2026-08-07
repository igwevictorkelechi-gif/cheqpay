import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptPii,
  encryptPii,
  fingerprintMatches,
  fingerprintPii,
  isPiiEncryptionConfigured,
  last4,
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
