import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { platformSettingsUpdateSchema } from "@/lib/validation";
import {
  getSwapSpreadBps,
  getUsdtNgnRate,
  setSwapSpreadBps,
  setUsdtNgnRate,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Admin: read the business-controlled spread + USDT->NGN rate. */
export async function GET(req: Request) {
  try {
    requireAdmin(req);
    const [spreadBps, usdtNgnRate] = await Promise.all([
      getSwapSpreadBps(),
      getUsdtNgnRate(),
    ]);
    return jsonOk({ spreadBps, usdtNgnRate });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: set the spread margin and/or the USDT->NGN rate. */
export async function PUT(req: Request) {
  try {
    requireAdmin(req);
    const updatedBy = req.headers.get("x-admin-actor") ?? "admin";
    const body = platformSettingsUpdateSchema.parse(await req.json());

    if (body.spreadBps !== undefined) {
      await setSwapSpreadBps(body.spreadBps, updatedBy);
    }
    if (body.usdtNgnRate !== undefined) {
      await setUsdtNgnRate(body.usdtNgnRate, updatedBy);
    }

    const [spreadBps, usdtNgnRate] = await Promise.all([
      getSwapSpreadBps(),
      getUsdtNgnRate(),
    ]);
    return jsonOk({ spreadBps, usdtNgnRate });
  } catch (err) {
    return toErrorResponse(err);
  }
}
