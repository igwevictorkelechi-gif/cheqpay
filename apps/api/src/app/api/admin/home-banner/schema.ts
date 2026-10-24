import { z } from "zod";
import { ApiError } from "@/lib/http";
import { isAllowedBannerImage, type HomeBannerInput } from "@/lib/homeBanner";

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().transform((v) => (v ? v : null));

const bannerSchema = z.object({
  enabled: z.boolean(),
  imageUrl: z.string().trim().max(900_000).nullable(), // data: upload, https link, or our own image URL
  title: optionalText(40),
  message: optionalText(90),
  linkUrl: optionalText(300),
});

/** One banner as an admin sent it, checked. */
export function parseBannerInput(body: unknown): HomeBannerInput {
  const input = bannerSchema.parse(body);
  if (input.imageUrl && !isAllowedBannerImage(input.imageUrl)) {
    throw new ApiError(422, "The image must be an uploaded PNG, JPG or WebP, or an https link", "bad_image");
  }
  if (!input.imageUrl && !input.title) {
    throw new ApiError(422, "Add a banner image or a title", "empty_banner");
  }
  if (input.linkUrl && !input.linkUrl.startsWith("/") && !input.linkUrl.startsWith("https://")) {
    throw new ApiError(422, "The link must be an in-app path like /deposit or an https link", "bad_link");
  }
  return input;
}
