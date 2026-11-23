import { describe, expect, it } from "vitest";
import { detectPayTarget } from "./payTarget";

describe("detectPayTarget", () => {
  it("reads a username, with or without @", () => {
    expect(detectPayTarget("@Tobi")).toEqual({ kind: "user", username: "tobi" });
    expect(detectPayTarget("ada_okafor")).toEqual({ kind: "user", username: "ada_okafor" });
  });

  it("reads 10 digits as a bank account", () => {
    expect(detectPayTarget("0123456789")).toEqual({ kind: "account", accountNumber: "0123456789" });
    expect(detectPayTarget("0123 456 789")).toEqual({ kind: "account", accountNumber: "0123456789" });
  });

  it("reads Nigerian mobile numbers as phones, in local or +234 form", () => {
    expect(detectPayTarget("08031234567")).toEqual({ kind: "phone", phone: "08031234567" });
    expect(detectPayTarget("+234 803 123 4567")).toEqual({ kind: "phone", phone: "08031234567" });
  });

  it("reads other 11–13 digit numbers as a meter or smartcard", () => {
    expect(detectPayTarget("45218890123")).toEqual({ kind: "meter", number: "45218890123" });
    expect(detectPayTarget("1234567890123")).toEqual({ kind: "meter", number: "1234567890123" });
  });

  it("refuses what it can't place rather than guessing", () => {
    expect(detectPayTarget("12345").kind).toBe("unknown");
    expect(detectPayTarget("a").kind).toBe("unknown");
    expect(detectPayTarget("  ").kind).toBe("empty");
  });
});
