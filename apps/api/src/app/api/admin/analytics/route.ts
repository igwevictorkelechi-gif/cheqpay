import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const TX_TYPES = ["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "CONVERT", "BILL"];
const TX_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REVERSED"];

/** Naira (major units) as a number, from minor units. */
function ngn(minor: bigint): number {
  return Number(fromMinorUnits(minor, "NGN"));
}

/**
 * Admin analytics: platform KPIs, transaction trends by type/status, a daily
 * volume series, a bill-payments breakdown (by service + biller with success
 * rates), the KYC funnel, and custody balances by asset. Window = ?days (30).
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
    const since = new Date(Date.now() - days * DAY);

    const [
      totalUsers,
      activeUsers,
      totalWallets,
      totalTransactions,
      fundedWallets,
      kycTierGroups,
      kycRecordGroups,
      balanceGroups,
      typeGroups,
      statusGroups,
      feeAgg,
      windowTxns,
      billTxns,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.wallet.count(),
      prisma.transaction.count(),
      prisma.balance.count({ where: { available: { gt: 0 } } }),
      prisma.user.groupBy({ by: ["kycTier"], _count: { _all: true } }),
      prisma.kycRecord.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.balance.groupBy({ by: ["asset"], _sum: { available: true } }),
      prisma.transaction.groupBy({ by: ["type"], _count: { _all: true }, where: { createdAt: { gte: since } } }),
      prisma.transaction.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: since } } }),
      prisma.transaction.aggregate({ _sum: { fee: true }, where: { asset: "NGN", createdAt: { gte: since } } }),
      prisma.transaction.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, type: true, asset: true, amount: true },
        orderBy: { createdAt: "asc" },
        take: 5000,
      }),
      prisma.transaction.findMany({
        where: { type: "BILL", createdAt: { gte: since } },
        select: { amount: true, status: true, metadata: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
    ]);

    // Balances by asset (formatted).
    const balancesByAsset: Record<string, string> = { NGN: "0", BTC: "0", USDT: "0" };
    for (const b of balanceGroups) {
      balancesByAsset[b.asset] = fromMinorUnits(b._sum.available ?? 0n, b.asset);
    }

    // KYC funnel.
    const kycTiers: Record<string, number> = { "0": 0, "1": 0, "2": 0 };
    for (const g of kycTierGroups) kycTiers[String(g.kycTier)] = g._count._all;
    const kycRecords: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const g of kycRecordGroups) kycRecords[g.status] = g._count._all;

    // Transactions by type / status (window).
    const typeCounts: Record<string, number> = {};
    for (const t of TX_TYPES) typeCounts[t] = 0;
    for (const g of typeGroups) typeCounts[g.type] = g._count._all;
    const statusCounts: Record<string, number> = {};
    for (const s of TX_STATUSES) statusCounts[s] = 0;
    for (const g of statusGroups) statusCounts[g.status] = g._count._all;
    const windowCount = TX_STATUSES.reduce((a, s) => a + statusCounts[s], 0);
    const successRate = windowCount > 0 ? Number(((statusCounts.COMPLETED / windowCount) * 100).toFixed(1)) : 0;

    // NGN volume by type + daily series (seed every day so the chart is continuous).
    const ngnVolumeByType: Record<string, number> = {};
    for (const t of TX_TYPES) ngnVolumeByType[t] = 0;
    const dayMap: Record<string, { count: number; ngnVolume: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      dayMap[key] = { count: 0, ngnVolume: 0 };
    }
    for (const t of windowTxns) {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (!dayMap[key]) dayMap[key] = { count: 0, ngnVolume: 0 };
      dayMap[key].count += 1;
      if (t.asset === "NGN") {
        const v = ngn(t.amount);
        dayMap[key].ngnVolume += v;
        ngnVolumeByType[t.type] = (ngnVolumeByType[t.type] ?? 0) + v;
      }
    }
    const daily = Object.entries(dayMap)
      .map(([date, v]) => ({ date, count: v.count, ngnVolume: Math.round(v.ngnVolume) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Bill payments breakdown.
    const svc: Record<string, { count: number; ngnVolume: number; completed: number; failed: number }> = {};
    const billerMap: Record<string, { count: number; ngnVolume: number }> = {};
    let billCount = 0;
    let billVolume = 0;
    let billCompleted = 0;
    for (const t of billTxns) {
      const m = (t.metadata ?? {}) as { service?: string; billerName?: string };
      const service = m.service ?? "other";
      const biller = m.billerName ?? "Unknown";
      const v = ngn(t.amount);
      billCount += 1;
      billVolume += v;
      if (t.status === "COMPLETED") billCompleted += 1;
      svc[service] = svc[service] ?? { count: 0, ngnVolume: 0, completed: 0, failed: 0 };
      svc[service].count += 1;
      svc[service].ngnVolume += v;
      if (t.status === "COMPLETED") svc[service].completed += 1;
      if (t.status === "FAILED") svc[service].failed += 1;
      billerMap[biller] = billerMap[biller] ?? { count: 0, ngnVolume: 0 };
      billerMap[biller].count += 1;
      billerMap[biller].ngnVolume += v;
    }
    const billsByService = Object.entries(svc)
      .map(([service, s]) => ({
        service,
        count: s.count,
        ngnVolume: Math.round(s.ngnVolume),
        successRate: s.count > 0 ? Number(((s.completed / s.count) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.ngnVolume - a.ngnVolume);
    const topBillers = Object.entries(billerMap)
      .map(([name, b]) => ({ name, count: b.count, ngnVolume: Math.round(b.ngnVolume) }))
      .sort((a, b) => b.ngnVolume - a.ngnVolume)
      .slice(0, 8);

    // Crypto activity: per-asset trade counts + custody balance (window).
    const CRYPTO_ASSETS = ["BTC", "USDT"];
    const cryptoStats: Record<
      string,
      { count: number; volume: number; buy: number; sell: number; convert: number }
    > = {};
    let cryptoTotal = 0;
    for (const t of windowTxns) {
      if (!CRYPTO_ASSETS.includes(t.asset)) continue;
      const s =
        cryptoStats[t.asset] ??
        (cryptoStats[t.asset] = { count: 0, volume: 0, buy: 0, sell: 0, convert: 0 });
      s.count += 1;
      cryptoTotal += 1;
      s.volume += Number(fromMinorUnits(t.amount, t.asset));
      if (t.type === "BUY") s.buy += 1;
      else if (t.type === "SELL") s.sell += 1;
      else if (t.type === "CONVERT") s.convert += 1;
    }
    const cryptoByAsset = CRYPTO_ASSETS.filter((a) => cryptoStats[a]?.count)
      .map((asset) => ({
        asset,
        count: cryptoStats[asset].count,
        volume: cryptoStats[asset].volume,
        buy: cryptoStats[asset].buy,
        sell: cryptoStats[asset].sell,
        convert: cryptoStats[asset].convert,
        balance: balancesByAsset[asset] ?? "0",
      }))
      .sort((a, b) => b.count - a.count);

    return jsonOk({
      windowDays: days,
      kpis: {
        totalUsers,
        activeUsers,
        totalWallets,
        fundedWallets,
        totalTransactions,
        ngnVolumeWindow: daily.reduce((a, d) => a + d.ngnVolume, 0),
        feesNgnWindow: Math.round(ngn(feeAgg._sum.fee ?? 0n)),
        successRate,
      },
      balancesByAsset,
      kyc: { tiers: kycTiers, records: kycRecords },
      transactions: {
        byType: TX_TYPES.map((t) => ({ type: t, count: typeCounts[t], ngnVolume: Math.round(ngnVolumeByType[t]) })),
        byStatus: TX_STATUSES.map((s) => ({ status: s, count: statusCounts[s] })),
        daily,
      },
      bills: {
        totals: {
          count: billCount,
          ngnVolume: Math.round(billVolume),
          successRate: billCount > 0 ? Number(((billCompleted / billCount) * 100).toFixed(1)) : 0,
        },
        byService: billsByService,
        topBillers,
      },
      crypto: { totalCount: cryptoTotal, byAsset: cryptoByAsset },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
