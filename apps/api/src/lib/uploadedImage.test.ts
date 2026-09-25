import { describe, expect, it } from "vitest";
import { MAX_IMAGE_LEN, imageValue } from "./uploadedImage";

/**
 * The server-side guard on admin image uploads (gadget products and events).
 *
 * This string is handed straight back to browsers and apps as an <img>/<Image>
 * source, so what it accepts is a security boundary, not just a format check.
 */

const ok = (v: string) => imageValue.safeParse(v).success;

describe("imageValue", () => {
  it("accepts the data URLs the upload field produces", () => {
    for (const type of ["png", "jpeg", "jpg", "webp", "gif", "svg+xml"]) {
      expect(ok(`data:image/${type};base64,iVBORw0KGgo=`), type).toBe(true);
    }
  });

  it("accepts an https URL only from our own storage", () => {
    expect(ok("https://xttgnswgeffyybjfjlkp.supabase.co/storage/v1/object/public/events/a.jpg")).toBe(true);
    // A third-party host would see every viewer's IP, and would force the
    // website's content security policy open.
    expect(ok("https://cdn.example.com/event.jpg")).toBe(false);
    expect(ok("https://evil.supabase.co.attacker.com/storage/x.jpg")).toBe(false);
  });

  it("accepts empty, meaning no image", () => {
    expect(ok("")).toBe(true);
  });

  it("refuses a data URL that is not an image", () => {
    // The one that matters: a data:text/html URL rendered from our own domain.
    expect(ok("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBe(false);
    expect(ok("data:application/javascript;base64,YWxlcnQoMSk=")).toBe(false);
    expect(ok("data:image/png,notbase64")).toBe(false);
  });

  it("refuses javascript: and plain http URLs", () => {
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("http://cdn.example.com/event.jpg")).toBe(false);
  });

  it("refuses anything over the size cap", () => {
    const head = "data:image/png;base64,";
    expect(ok(head + "A".repeat(MAX_IMAGE_LEN - head.length))).toBe(true);
    expect(ok(head + "A".repeat(MAX_IMAGE_LEN))).toBe(false);
  });
});
