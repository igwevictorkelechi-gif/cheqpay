import { Prisma, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getPaymentProvider } from "@/payments";
import { accountNameMatchesUser } from "@/lib/nameMatch";
import { addBeneficiarySchema } from "@/lib/validation";
import { ensureBeneficiariesTable } from "@/lib/ensureBeneficiaries";

export const dynamic = "force-dynamic";

/** List the user's saved payout beneficiaries. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await ensureBeneficiariesTable();
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
      },
    });
    return jsonOk({ beneficiaries });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Save a beneficiary. The account name is resolved via the PSP and must match
 * the user's KYC legal name, so a user can only withdraw to their own accounts.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await ensureBeneficiariesTable();
    const body = addBeneficiarySchema.parse(await req.json());

    const legalName = (auth.fullName ?? "").trim();
    if (!legalName) {
      throw new ApiError(
        403,
        "Add your name to your profile before adding a payout account",
        "name_required"
      );
    }

    // Resolve the real account holder name from the bank.
    const { accountName } = await getPaymentProvider().resolveBankAccount({
      accountNumber: body.accountNumber,
      bankCode: body.bankCode,
    });
    if (!accountName) {
      throw new ApiError(422, "Could not verify that account number", "resolve_failed");
    }

    // Enforce ownership: the account must be in the user's name.
    if (!accountNameMatchesUser(accountName, legalName)) {
      throw new ApiError(
        422,
        "This account isn’t in your name. You can only withdraw to your own bank account.",
        "name_mismatch"
      );
    }

    try {
      const beneficiary = await prisma.beneficiary.create({
        data: {
          userId: auth.id,
          bankCode: body.bankCode,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountName,
        },
        select: {
          id: true,
          bankCode: true,
          bankName: true,
          accountNumber: true,
          accountName: true,
        },
      });
      return jsonOk({ beneficiary }, 201);
    } catch (err) {
      // Already saved — return the existing one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const beneficiary = await prisma.beneficiary.findFirst({
          where: {
            userId: auth.id,
            bankCode: body.bankCode,
            accountNumber: body.accountNumber,
          },
          select: {
            id: true,
            bankCode: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
          },
        });
        return jsonOk({ beneficiary }, 200);
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
