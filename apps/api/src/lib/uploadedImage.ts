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
      /^https:\/\/\S+$/.test(s),
    "Image must be an uploaded image or an https URL under 300KB",
  );
