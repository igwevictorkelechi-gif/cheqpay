import { describe, expect, it } from "vitest";
import { ACTION_CODE, amountOf, capClassOf, idempotencyKeyFor } from "./actions";

describe("capClassOf", () => {
  it("puts only person-to-person in the tight class", () => {
    // withdraw is name-matched to the account holder and a bill reaches the
    // user's own meter, so neither is worth stealing. Only `transfer` can
    // reach a stranger.
    expect(capClassOf("transfer")).toBe("p2p");
    expect(capClassOf("withdraw")).toBe("self");
    expect(capClassOf("bill")).toBe("self");
  });
});

describe("idempotencyKeyFor", () => {
  it("is stable for a code, so a refresh replays instead of paying twice", () => {
    const code = "a".repeat(43);
    expect(idempotencyKeyFor(code)).toBe(idempotencyKeyFor(code));
  });

  it("differs between codes, so two payments stay two payments", () => {
    expect(idempotencyKeyFor("a".repeat(43))).not.toBe(idempotencyKeyFor("b".repeat(43)));
  });

  it("does not leak the code it came from", () => {
    const code = "z".repeat(43);
    expect(idempotencyKeyFor(code)).not.toContain(code);
  });

  it("fits the server's Idempotency-Key format", () => {
    expect(idempotencyKeyFor("c".repeat(43))).toMatch(/^[A-Za-z0-9_\-:.]{1,255}$/);
  });
});

describe("ACTION_CODE", () => {
  it("accepts a 43-character base64url code", () => {
    expect(ACTION_CODE.test("A1_-".padEnd(43, "x"))).toBe(true);
  });

  it("rejects the wrong length or alphabet", () => {
    expect(ACTION_CODE.test("x".repeat(42))).toBe(false);
    expect(ACTION_CODE.test("x".repeat(44))).toBe(false);
    expect(ACTION_CODE.test(`${"x".repeat(42)}+`)).toBe(false);
    expect(ACTION_CODE.test("")).toBe(false);
  });
});

describe("amountOf", () => {
  it("round-trips the string the payload carries", () => {
    // JSON has no bigint, so the amount lives as a string and must come back
    // exactly — a float here would lose kobo.
    expect(amountOf({ kind: "transfer", username: "tobi", amountMinor: "12345678901234" })).toBe(
      12345678901234n,
    );
  });
});
