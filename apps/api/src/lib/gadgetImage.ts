import { z } from "zod";

/**
 * A product image, validated for the admin catalog routes.
 *
 * Uploaded images arrive as base64 data URLs (the same storage approach as
 * bill-provider logos); an https URL is still accepted for anything already
 * stored that way. ~400k chars ≈ a 300KB image, which is the client-side cap.
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
