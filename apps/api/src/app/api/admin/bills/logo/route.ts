import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { billerExists } from "@/lib/bills";

export const dynamic = "force-dynamic";

// ~400k chars of base64 ≈ 300 KB image — plenty for a logo.
const MAX_LOGO_LEN = 400_000;

function isValidLogo(logo: unknown): logo is string {
  if (typeof logo !== "string" || logo.length === 0) return false;
  if (logo.length > MAX_LOGO_LEN) return false;
  // Accept an uploaded image data URL or an https URL.
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/.test(logo)) return true;
  if (/^https:\/\/\S+$/.test(logo)) return true;
  return false;
}

/** Admin: set/replace a biller's logo. Body: { billerId, logo }. */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json().catch(() => ({}))) as {
      billerId?: string;
      logo?: string;
    };
    const billerId = body.billerId?.trim();
    if (!billerId || !billerExists(billerId)) {
      throw new ApiError(422, "Unknown biller", "bad_biller");
    }
    if (!isValidLogo(body.logo)) {
      throw new ApiError(
        422,
        "Logo must be an image data URL or https URL under 300KB",
        "bad_logo"
      );
    }
    const asset = await prisma.billerAsset.upsert({
      where: { billerId },
      update: { logo: body.logo },
      create: { billerId, logo: body.logo },
    });
    return jsonOk({ billerId: asset.billerId, updatedAt: asset.updatedAt });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: remove a biller's uploaded logo (revert to the default tile). */
export async function DELETE(req: Request) {
  try {
    await requireAdmin(req);
    const billerId = new URL(req.url).searchParams.get("billerId")?.trim();
    if (!billerId) {
      throw new ApiError(422, "billerId is required", "no_biller");
    }
    await prisma.billerAsset.deleteMany({ where: { billerId } });
    return jsonOk({ billerId, removed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
