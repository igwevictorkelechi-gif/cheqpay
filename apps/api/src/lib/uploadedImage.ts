import { z } from "zod";

/**
 * An admin-uploaded image (gadget products, events), validated at the route.
 *
 * Uploaded images arrive as base64 data URLs (the same storage approach as
 * bill-provider logos); an https URL is still accepted for anything already
 * stored that way. ~400k chars ≈ a 300KB image, which is the client-side cap.
 *
 * The allowlist of types matters: this string is handed straight back to
 * browsers and apps in an <img>/<Image> src, so anything outside these image
 * types — a `data:text/html` URL above all — must never be storable here.
 */
export const MAX_IMAGE_LEN = 400_000;

export const imageValue = z
  .string()
  .max(MAX_IMAGE_LEN)
  .refine(
    (s) =>
      s === "" ||
      /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/.test(s) ||
      // Our own storage only: an arbitrary https image would let a third party
      // see every visitor's IP and when they looked, and would force the
      // website's content security policy open to the whole internet.
      /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/\S+$/.test(s),
    "Image must be an uploaded image under 300KB",
  );
