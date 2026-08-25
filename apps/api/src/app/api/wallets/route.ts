import { Asset, Network, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { listWallets, provisionWallets } from "@/lib/wallets";
import { AVAILABLE_WALLETS, isSupportedWallet, isWithdrawableNetwork } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** List the user's crypto deposit wallets (does not provision). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({
      wallets: await listWallets(auth.id),
      // What else the user could ask for, so the client can offer a chain picker
      // without hardcoding the list.
      available: AVAILABLE_WALLETS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Provision crypto deposit wallets (idempotent).
 *
 * With no body this mints the launch set. Passing `{asset, network}` mints one
 * specific pair on demand — that is how a user gets USDT on Base or Polygon
 * rather than only the default chain.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    // Body is optional: an empty/absent body keeps the original behaviour.
    const body = (await req.json().catch(() => null)) as
      | { asset?: string; network?: string; offramp?: boolean }
      | null;

    if (body?.asset || body?.network) {
      const asset = String(body.asset ?? "").toUpperCase() as Asset;
      const network = String(body.network ?? "").toUpperCase() as Network;
      if (!isSupportedWallet(asset, network)) {
        throw new ApiError(
          422,
          `${body.asset}/${body.network} is not a supported deposit pair`,
          "bad_pair",
        );
      }
      // A chain the user could never send from can only be minted as an offramp
      // address, where the arrival converts to USD and no coin is stranded.
      // Decided here rather than by the caller: a client that omitted the flag
      // would otherwise get a refusal it has no way to interpret, which is
      // exactly how every non-Solana "generate" silently failed. An explicit
      // `offramp` from the caller still wins.
      const offramp = body.offramp ?? !isWithdrawableNetwork(network);

      return jsonOk({
        wallets: await provisionWallets(auth.id, [{ asset, network }], offramp),
        // So the client can say "arrives as USD" rather than implying coin.
        offramp,
      });
    }

    return jsonOk({ wallets: await provisionWallets(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
