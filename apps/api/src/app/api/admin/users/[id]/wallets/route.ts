import { Asset, Network, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { listWallets, provisionWalletsDetailed } from "@/lib/wallets";
import { AVAILABLE_WALLETS, SUPPORTED_WALLETS, isSupportedWallet } from "@/lib/assets";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin-only: the user's crypto deposit addresses, and what could still be minted.
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

    const wallets = await listWallets(id);
    const have = new Set(wallets.map((w) => `${w.asset}/${w.network}`));

    return jsonOk({
      enrolled: Boolean(user.mapleradCustomerId),
      customerId: user.mapleradCustomerId,
      wallets,
      // Everything mintable that this user does not hold yet.
      mintable: AVAILABLE_WALLETS.filter((p) => !have.has(`${p.asset}/${p.network}`)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin-only: mint a unique deposit address for a user, on demand.
 *
 * The repair tool for crypto. Provisioning is best-effort everywhere else — a
 * login must not fail because custody is down — which means a user can end up
 * with no address and nothing on screen explaining why. This runs the same mint
 * and returns the provider's actual error per pair, so an operator can see the
 * cause instead of guessing.
 *
 * With no body it mints the launch set. `{asset, network}` mints one specific
 * pair; `offramp` is required for any chain other than Solana, since only Solana
 * can be withdrawn from (see custody/maplerad.ts).
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
      // Addresses hang off the Maplerad customer, so this is the real blocker
      // and worth naming rather than letting the mint fail opaquely.
      throw new ApiError(
        409,
        "User is not enrolled with Maplerad. Run Enrol / upgrade tier first.",
        "not_enrolled",
      );
    }

    const body = (await req.json().catch(() => null)) as
      | { asset?: string; network?: string; offramp?: boolean }
      | null;

    let pairs = SUPPORTED_WALLETS;
    if (body?.asset || body?.network) {
      const asset = String(body.asset ?? "").toUpperCase() as Asset;
      const network = String(body.network ?? "").toUpperCase() as Network;
      if (!isSupportedWallet(asset, network)) {
        throw new ApiError(
          422,
          `${body.asset}/${body.network} is not a mintable pair`,
          "bad_pair",
        );
      }
      pairs = [{ asset, network }];
    }

    const report = await provisionWalletsDetailed(id, pairs, body?.offramp);

    const created = report.outcomes.filter((o) => o.status === "created");
    if (created.length) {
      await prisma.auditLog
        .create({
          data: {
            userId: id,
            action: "admin.crypto_wallets.generated",
            resourceType: "Wallet",
            resourceId: created.map((o) => `${o.asset}/${o.network}`).join(","),
            details: { actor, created: created.length },
          },
        })
        .catch((err) => console.error("[admin] wallet audit write failed", err));
    }

    return jsonOk({
      wallets: report.wallets,
      outcomes: report.outcomes,
      blocked: report.blocked ?? null,
      message: report.blocked
        ? `Nothing minted: ${report.blocked}`
        : created.length
          ? `Generated ${created.length} address${created.length === 1 ? "" : "es"}.`
          : "No new addresses — the user already holds every requested pair, or every attempt failed (see outcomes).",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
