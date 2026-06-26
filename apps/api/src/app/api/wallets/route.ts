import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { listWallets, provisionWallets } from "@/lib/wallets";

export const dynamic = "force-dynamic";

/** List the user's crypto deposit wallets (does not provision). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({ wallets: await listWallets(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Provision the launch set of wallets (idempotent). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    return jsonOk({ wallets: await provisionWallets(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
