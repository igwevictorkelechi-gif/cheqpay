import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { createUsdAccountSchema } from "@/lib/validation";
import { createUsdVirtualAccount, getUsdAccount } from "@/lib/usdAccount";
import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/** The user's USD virtual account, or null if they have not opened one. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({ usdAccount: await getUsdAccount(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Open the user's USD virtual account.
 *
 * Requires an enrolled Maplerad customer (the account hangs off the customer
 * id), so it fails clearly when the user is not yet verified rather than letting
 * the provider return an opaque error. Idempotent — returns the existing account
 * if one already exists.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    // USD accounts sit behind the same deposit flag as NGN — nothing here
    // creates a second surface to turn on and off.
    await assertFeatureEnabled("ngn_deposits");

    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { mapleradCustomerId: true },
    });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    if (!user.mapleradCustomerId) {
      throw new ApiError(
        409,
        "Finish identity verification before opening a USD account.",
        "not_enrolled",
      );
    }

    const body = createUsdAccountSchema.parse(await req.json());

    try {
      const usdAccount = await createUsdVirtualAccount(auth.id, {
        identification_number: body.identificationNumber,
        employment_status: body.employmentStatus,
        employment_description: body.employmentDescription,
        nationality: body.nationality,
        employer_name: body.employerName,
        us_residency_status: body.usResidencyStatus,
      });
      return jsonOk({ usdAccount }, 201);
    } catch (err) {
      if (err instanceof Error && err.message === "not_enrolled") {
        throw new ApiError(
          409,
          "Finish identity verification before opening a USD account.",
          "not_enrolled",
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
