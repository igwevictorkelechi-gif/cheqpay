import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { requestContext } from "@/lib/requestContext";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createAccount, getAccountForOwner, renameAccount } from "@/lib/devapi/accounts";
import { getSubscription, liveAccessProblem } from "@/lib/devapi/billing";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { recordDevAudit } from "@/lib/devapi/audit";
import { effectiveLimits, getDevLimits } from "@/lib/devapi/limits";
import { listApiKeys, keyIsActive } from "@/lib/devapi/keys";
import { getPlans } from "@/lib/devapi/plans";
import { dashboardAccountView, limitsView, subscriptionView, walletObject } from "@/lib/devapi/serialize";
import type { WalletRow } from "@/lib/devapi/types";

export const dynamic = "force-dynamic";

/** Everything the dashboard's overview needs, in one call. `account` is null until one is opened. */
export async function GET(req: Request) {
  try {
    await assertFeatureEnabled("developer_api");
    const user = await requireUser(req);
    const owner = await prisma.user.findUnique({ where: { id: user.id }, select: { kycTier: true, email: true } });
    const account = await getAccountForOwner(user.id);
    const ownerView = { email: owner?.email ?? null, kyc_tier: owner?.kycTier ?? 0, two_factor: user.aal === "aal2" };
    if (!account) return jsonOk({ account: null, owner: ownerView });

    const [plans, sub, limits, keys, wallets] = await Promise.all([
      getPlans(),
      getSubscription(account.id),
      getDevLimits(),
      listApiKeys(account.id),
      prisma.$queryRawUnsafe<WalletRow[]>(
        `SELECT * FROM dev_wallets WHERE account_id = $1::uuid AND customer_id IS NULL ORDER BY mode, currency`,
        account.id,
      ),
    ]);
    const problem = liveAccessProblem(account, sub, plans);
    const active = keys.filter((k) => keyIsActive(k));
    return jsonOk({
      account: dashboardAccountView(account),
      owner: ownerView,
      subscription: subscriptionView(sub),
      live_enabled: problem === null,
      live_problem: problem ? { code: problem.code, message: problem.message } : null,
      limits: limitsView(effectiveLimits(account, limits)),
      wallets: {
        test: wallets.filter((w) => w.mode === "test").map(walletObject),
        live: wallets.filter((w) => w.mode === "live").map(walletObject),
      },
      checklist: {
        test_key: active.some((k) => k.mode === "test"),
        two_factor: user.aal === "aal2",
        identity_verified: (owner?.kycTier ?? 0) >= 1,
        business_verified: account.status === "approved",
        plan: problem === null,
        live_key: active.some((k) => k.mode === "live"),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Open a developer account (a sandbox). Anyone with a CheqPay account can. */
export async function POST(req: Request) {
  try {
    await assertFeatureEnabled("developer_api");
    const user = await requireUser(req);
    await enforceRateLimit(`dev:account:create:${user.id}`, 5, 60_000);
    const body = (await req.json().catch(() => ({}))) as { business_name?: unknown };
    const existed = await getAccountForOwner(user.id);
    const account = await createAccount(user.id, { businessName: body.business_name });
    if (!existed) {
      const { ip, userAgent } = requestContext(req);
      await recordDevAudit({ accountId: account.id, actor: "owner", action: "account.opened", ip, userAgent });
    }
    return jsonOk({ account: dashboardAccountView(account) }, existed ? 200 : 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Rename the business (until it is verified). */
export async function PATCH(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const body = (await req.json().catch(() => ({}))) as { business_name?: unknown };
    const account = await renameAccount(s.account, body.business_name);
    await recordDevAudit({ accountId: account.id, actor: "owner", action: "account.renamed", ip: s.ip, userAgent: s.userAgent });
    return jsonOk({ account: dashboardAccountView(account) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
