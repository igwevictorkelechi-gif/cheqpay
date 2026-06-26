import { Asset, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits } from "@/lib/money";
import { createQuote } from "@/lib/swap";
import { quoteCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Issue a server-side swap quote (short TTL). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const body = quoteCreateSchema.parse(await req.json());
    const cryptoAsset = body.asset as Asset;
    // For buy, the amount is NGN; for sell, it's the crypto asset.
    const fromAsset = body.side === "buy" ? Asset.NGN : cryptoAsset;
    const amountInMinor = toMinorUnits(body.amount, fromAsset);

    const quote = await createQuote({
      userId: auth.id,
      tier: user.kycTier,
      side: body.side,
      cryptoAsset,
      amountInMinor,
    });

    return jsonOk(
      {
        quoteId: quote.id,
        side: body.side,
        fromAsset: quote.fromAsset,
        toAsset: quote.toAsset,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        rate: quote.rate.toString(),
        expiresAt: quote.expiresAt.toISOString(),
      },
      201
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
