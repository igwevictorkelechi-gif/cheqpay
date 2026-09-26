import { Asset, prisma } from "@cheqpay/db";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
import { getProviderBalances, resetTreasuryCache } from "@/lib/maplerad/treasury";
import { notifyAdminAlert } from "@/lib/adminAlert";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Daily check that our business wallets at Maplerad hold at least what our
 * ledger says users own. Users' dollars and naira are pooled there; when the
 * pool is smaller than what we owe, swaps and withdrawals start failing at the
 * provider. This catches the gap before a customer does, and alerts ops with
 * the amount to top up.
 */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;

    resetTreasuryCache();
    const held = await getProviderBalances();
    const owed = await prisma.balance.groupBy({
      by: ["asset"],
      where: { asset: { in: [Asset.NGN, Asset.USD] } },
      _sum: { available: true, locked: true },
    });

    const report: Array<{ currency: "NGN" | "USD"; heldMinor: string | null; owedMinor: string; shortMinor: string }> = [];
    const shortfalls: string[] = [];
    for (const currency of ["NGN", "USD"] as const) {
      const row = owed.find((r) => r.asset === currency);
      const owedMinor = BigInt(row?._sum.available ?? 0) + BigInt(row?._sum.locked ?? 0);
      const heldMinor = held[currency];
      const short = heldMinor !== null && heldMinor < owedMinor ? owedMinor - heldMinor : 0n;
      report.push({
        currency,
        heldMinor: heldMinor?.toString() ?? null,
        owedMinor: owedMinor.toString(),
        shortMinor: short.toString(),
      });
      if (short > 0n) {
        const fmt = (m: bigint) =>
          currency === "USD" ? `$${fromMinorUnits(m, Asset.USD)}` : `₦${fromMinorUnits(m, Asset.NGN)}`;
        shortfalls.push(
          `${currency}: Maplerad holds ${fmt(heldMinor!)}, users are owed ${fmt(owedMinor)} — top up ${fmt(short)}`,
        );
      }
    }

    if (shortfalls.length > 0) {
      await notifyAdminAlert(
        `⚠️ CheqPay treasury shortfall — swaps and withdrawals may fail until topped up. ${shortfalls.join("; ")}`,
        Object.fromEntries(report.map((r) => [r.currency, `held ${r.heldMinor ?? "?"} owed ${r.owedMinor}`])),
      );
    }
    return jsonOk({ ok: true, report, alerted: shortfalls.length > 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
