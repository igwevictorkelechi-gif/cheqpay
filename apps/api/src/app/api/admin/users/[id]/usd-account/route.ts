import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { createUsdAccountSchema } from "@/lib/validation";
import {
  checkUsdAccountStatus,
  createUsdVirtualAccount,
  getUsdAccount,
} from "@/lib/usdAccount";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin-only: where does this user's USD account stand?
 *
 * Returns the stored account (if any) plus a live status poll, so an operator
 * can tell "never opened" from "open but still in review" without guessing —
 * the two look identical from the user's side.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, mapleradCustomerId: true },
    });
    if (!user) throw new ApiError(404, "User not found", "no_user");

    const account = await getUsdAccount(id);
    // Best-effort: a provider hiccup must not hide the stored account.
    const status = await checkUsdAccountStatus(id).catch((err) => {
      console.error("[admin] USD status poll failed", err);
      return null;
    });

    return jsonOk({
      enrolled: Boolean(user.mapleradCustomerId),
      customerId: user.mapleradCustomerId,
      account,
      status,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin-only: manually open a user's USD account.
 *
 * The mirror of the NGN enrol/repair tool. A user can be stuck with no dollar
 * account because the client form was never completed or the provider rejected
 * one field; this lets an operator supply the US-banking KYC and open it on
 * their behalf. Idempotent — an existing account is returned untouched rather
 * than opening a second one.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, mapleradCustomerId: true },
    });
    if (!user) throw new ApiError(404, "User not found", "no_user");
    if (!user.mapleradCustomerId) {
      // The USD account hangs off the Maplerad customer, so enrolment first.
      throw new ApiError(
        409,
        "User is not enrolled with Maplerad. Run Enrol / upgrade tier first.",
        "not_enrolled",
      );
    }

    const existing = await getUsdAccount(id);
    if (existing) {
      return jsonOk({
        created: false,
        message: "This user already has a USD account.",
        account: existing,
      });
    }

    const body = createUsdAccountSchema.parse(await req.json());

    let account;
    try {
      account = await createUsdVirtualAccount(id, {
        identification_number: body.identificationNumber,
        employment_status: body.employmentStatus,
        employment_description: body.employmentDescription,
        nationality: body.nationality,
        employer_name: body.employerName,
        us_residency_status: body.usResidencyStatus,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "not_enrolled") {
        throw new ApiError(
          409,
          "User is not enrolled with Maplerad. Run Enrol / upgrade tier first.",
          "not_enrolled",
        );
      }
      throw err;
    }

    await prisma.auditLog.create({
      data: {
        userId: id,
        action: "admin.usd_account.opened",
        resourceType: "Wallet",
        resourceId: account.accountNumber,
        details: {
          actor,
          bankName: account.bankName,
          consentRequired: account.consentRequired,
          status: account.status ?? null,
        },
      },
    }).catch((err) => console.error("[admin] USD account audit write failed", err));

    return jsonOk(
      {
        created: true,
        message: account.consentRequired
          ? "USD account opened — the holder must still accept US banking terms."
          : "USD account opened.",
        account,
      },
      201,
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
