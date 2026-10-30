import { Asset, Prisma, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { priceAlertCreateSchema } from "@/lib/validation";
import { ensurePriceAlertsSchema } from "@/lib/ensurePriceAlerts";

export const dynamic = "force-dynamic";

/** The most active alerts one account may hold at once. */
const MAX_ACTIVE_ALERTS = 20;

interface AlertView {
  id: string;
  asset: string;
  direction: string;
  target: string;
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

function view(a: {
  id: string;
  asset: Asset;
  direction: string;
  targetUsd: Prisma.Decimal;
  active: boolean;
  createdAt: Date;
  lastTriggeredAt: Date | null;
}): AlertView {
  return {
    id: a.id,
    asset: a.asset,
    direction: a.direction,
    target: a.targetUsd.toString(),
    active: a.active,
    createdAt: a.createdAt.toISOString(),
    lastTriggeredAt: a.lastTriggeredAt ? a.lastTriggeredAt.toISOString() : null,
  };
}

/** List this user's standing price alerts, newest first. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("price_alerts");
    await ensurePriceAlertsSchema();
    const alerts = await prisma.priceAlert.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk({ alerts: alerts.map(view) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Create a standing price alert ("notify me when BTC goes above $X"). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("price_alerts");
    await ensurePriceAlertsSchema();
    await enforceRateLimit(`price-alert:add:${auth.id}`, 20, 60_000);

    const body = priceAlertCreateSchema.parse(await req.json());

    const activeCount = await prisma.priceAlert.count({
      where: { userId: auth.id, active: true },
    });
    if (activeCount >= MAX_ACTIVE_ALERTS) {
      throw new ApiError(
        422,
        `You can have at most ${MAX_ACTIVE_ALERTS} active alerts. Delete one first.`,
        "too_many_alerts",
      );
    }

    const alert = await prisma.priceAlert.create({
      data: {
        userId: auth.id,
        asset: body.asset as Asset,
        direction: body.direction,
        targetUsd: new Prisma.Decimal(body.target),
      },
    });
    return jsonOk({ alert: view(alert) }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
