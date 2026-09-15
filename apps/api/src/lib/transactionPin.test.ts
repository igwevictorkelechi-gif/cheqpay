import { describe, expect, it } from "vitest";
import {
  assertPinStrength,
  hashPin,
  readPin,
  verifyPinHash,
  PIN_HEADER,
} from "./transactionPin";
import { ApiError } from "./http";

describe("assertPinStrength", () => {
  it("accepts an ordinary 4-digit PIN", () => {
    expect(() => assertPinStrength("8305")).not.toThrow();
  });

  it("accepts a 6-digit PIN", () => {
    expect(() => assertPinStrength("830571")).not.toThrow();
  });

  it("rejects anything that is not digits", () => {
    expect(() => assertPinStrength("83a5")).toThrow(ApiError);
    expect(() => assertPinStrength("8 05")).toThrow(/digits only/);
  });

  it("rejects PINs that are too short or too long", () => {
    expect(() => assertPinStrength("830")).toThrow(/between 4 and 6/);
    expect(() => assertPinStrength("8305712")).toThrow(/between 4 and 6/);
  });

  it("rejects a repeated digit", () => {
    expect(() => assertPinStrength("7777")).toThrow(/same digit/);
    expect(() => assertPinStrength("222222")).toThrow(/same digit/);
  });

  it("rejects ascending and descending runs, including wraps", () => {
    expect(() => assertPinStrength("3456")).toThrow(/consecutive/);
    expect(() => assertPinStrength("6543")).toThrow(/consecutive/);
    // 8901 wraps past 9 — still a run on the keypad, still guessed early.
    expect(() => assertPinStrength("8901")).toThrow(/consecutive/);
  });

  it("rejects the commonly guessed PINs", () => {
    expect(() => assertPinStrength("1234")).toThrow(ApiError);
    expect(() => assertPinStrength("2580")).toThrow(/commonly guessed/);
    expect(() => assertPinStrength("112233")).toThrow(/commonly guessed/);
  });
});

describe("hashPin / verifyPinHash", () => {
  it("verifies the PIN it hashed", async () => {
    const stored = await hashPin("8305");
    expect(await verifyPinHash("8305", stored)).toBe(true);
  });

  it("rejects a different PIN", async () => {
    const stored = await hashPin("8305");
    expect(await verifyPinHash("8306", stored)).toBe(false);
    expect(await verifyPinHash("", stored)).toBe(false);
  });

  it("salts, so the same PIN hashes differently every time", async () => {
    const a = await hashPin("8305");
    const b = await hashPin("8305");
    expect(a).not.toEqual(b);
    // ...and both still verify.
    expect(await verifyPinHash("8305", a)).toBe(true);
    expect(await verifyPinHash("8305", b)).toBe(true);
  });

  it("never stores the PIN in the clear", async () => {
    const stored = await hashPin("8305");
    expect(stored).not.toContain("8305");
  });

  it("encodes its cost parameters so they can be raised later", async () => {
    const stored = await hashPin("8305");
    const [scheme, N, r, p] = stored.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  // A corrupt or truncated hash must read as "wrong PIN", never as authorised.
  it("treats a malformed stored hash as a failed verification", async () => {
    expect(await verifyPinHash("8305", "")).toBe(false);
    expect(await verifyPinHash("8305", "not-a-hash")).toBe(false);
    expect(await verifyPinHash("8305", "scrypt$16384$8$1$onlyfiveparts")).toBe(false);
    expect(await verifyPinHash("8305", "bcrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPinHash("8305", "scrypt$x$y$z$c2FsdA==$aGFzaA==")).toBe(false);
    // Well-formed but empty salt/key.
    expect(await verifyPinHash("8305", "scrypt$16384$8$1$$")).toBe(false);
  });
});

describe("readPin", () => {
  const withHeaders = (h: Record<string, string>) =>
    new Request("https://example.test/api/transfers", { method: "POST", headers: h });

  it("reads the PIN from the header", () => {
    expect(readPin(withHeaders({ [PIN_HEADER]: "8305" }))).toBe("8305");
  });

  it("is null when the header is absent or blank", () => {
    expect(readPin(withHeaders({}))).toBeNull();
    expect(readPin(withHeaders({ [PIN_HEADER]: "   " }))).toBeNull();
  });

  // The PIN travels in a header precisely so it cannot be swept into a
  // transaction's metadata by a body spread. Guard that it is not read
  // from the body by accident.
  it("does not read a PIN out of the request body", async () => {
    const req = new Request("https://example.test/api/transfers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "8305", amount: "100" }),
    });
    expect(readPin(req)).toBeNull();
  });
});
