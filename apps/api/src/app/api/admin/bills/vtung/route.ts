import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { vtuNgIfConfigured } from "@/payments";

export const dynamic = "force-dynamic";

/**
 * Admin: does vtu.ng work from here? Signs in, reads our wallet balance and
 * one data and one TV plan list. Makes no purchase. Use it after setting the
 * credentials and before switching BILLS_PROVIDER to vtung.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const vtu = vtuNgIfConfigured();
    if (!vtu) return jsonOk({ configured: false, active: false });
    const step = async <T>(fn: () => Promise<T>) => {
      try {
        return { ok: true as const, value: await fn() };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    };
    const [balance, data, tv] = await Promise.all([
      step(() => vtu.balance()),
      step(async () => (await vtu.listBillPlans("data", "mtn")).length),
      step(async () => (await vtu.listBillPlans("cabletv", "gotv")).length),
    ]);
    return jsonOk({
      configured: true,
      active: getEnv().BILLS_PROVIDER === "vtung",
      webhookSigned: Boolean(getEnv().VTU_NG_PIN),
      balanceNaira: balance,
      mtnDataPlans: data,
      gotvPlans: tv,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
