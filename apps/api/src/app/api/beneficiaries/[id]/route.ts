import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { ensureBeneficiariesTable } from "@/lib/ensureBeneficiaries";

export const dynamic = "force-dynamic";

/** Delete one of the user's saved beneficiaries. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUser(req);
    await ensureBeneficiariesTable();
    const { id } = await params;
    // Scoped delete: only removes the row if it belongs to this user.
    await prisma.beneficiary.deleteMany({ where: { id, userId: auth.id } });
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
