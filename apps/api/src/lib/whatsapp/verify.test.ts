import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifySubscription, verifyWhatsappSignature } from "./verify";

const SECRET = "test-app-secret";
const BODY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.1" }] } }] }] });
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifyWhatsappSignature", () => {
  it("accepts Meta's signature over the exact bytes", () => {
    expect(verifyWhatsappSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("accepts the digest without the sha256= prefix", () => {
    expect(verifyWhatsappSignature(BODY, sign(BODY).slice(7), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(BODY);
    const tampered = BODY.replace("wamid.1", "wamid.2");
    expect(verifyWhatsappSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyWhatsappSignature(BODY, sign(BODY, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWhatsappSignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects a malformed digest without throwing", () => {
    expect(verifyWhatsappSignature(BODY, "sha256=not-hex", SECRET)).toBe(false);
    expect(verifyWhatsappSignature(BODY, "sha256=abcd", SECRET)).toBe(false);
    expect(verifyWhatsappSignature(BODY, "", SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    // An unsigned endpoint would let anyone impersonate any customer, so the
    // absence of a secret must refuse rather than wave requests through.
    expect(verifyWhatsappSignature(BODY, sign(BODY), null)).toBe(false);
  });

  it("is sensitive to whitespace, so the raw body must be used", () => {
    // JSON.parse + JSON.stringify does not reproduce Meta's bytes. This is the
    // mistake the route comment warns about.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyWhatsappSignature(reserialised, sign(BODY), SECRET)).toBe(false);
  });
});

describe("verifySubscription", () => {
  const url = (params: Record<string, string>) =>
    new URL(`https://api.example.com/api/webhooks/whatsapp?${new URLSearchParams(params)}`);

  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  });
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  it("echoes the challenge when the token matches", () => {
    const got = verifySubscription(
      url({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" }),
    );
    expect(got).toBe("1158201444");
  });

  it("refuses a wrong token", () => {
    expect(
      verifySubscription(url({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "x" })),
    ).toBeNull();
  });

  it("refuses a token of a different length without throwing", () => {
    // timingSafeEqual throws on mismatched lengths; the guard must come first.
    expect(
      verifySubscription(url({ "hub.mode": "subscribe", "hub.verify_token": "short", "hub.challenge": "x" })),
    ).toBeNull();
  });

  it("refuses the wrong mode", () => {
    expect(
      verifySubscription(url({ "hub.mode": "unsubscribe", "hub.verify_token": "verify-me", "hub.challenge": "x" })),
    ).toBeNull();
  });

  it("refuses when no token is configured", () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect(
      verifySubscription(url({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "x" })),
    ).toBeNull();
  });
});
