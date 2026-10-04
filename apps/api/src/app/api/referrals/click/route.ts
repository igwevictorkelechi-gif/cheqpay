import { z } from "zod";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { recordClick } from "@/lib/referrals";
import { clientIp } from "@/lib/requestContext";

export const dynamic = "force-dynamic";

/** Public: count a click on an influencer's tracking link. Stores no personal data. */
export async function POST(req: Request) {
  try {
    const { code } = z.object({ code: z.string().min(1).max(40) }).parse(await req.json());
    // One counted click per address per code per few minutes, so refreshing doesn't inflate numbers.
    try {
      await enforceRateLimit(`ref-click:${clientIp(req) ?? "unknown"}:${code.toLowerCase()}`, 1, 10 * 60_000);
    } catch {
      return jsonOk({ counted: false });
    }
    return jsonOk({ counted: !!(await recordClick(code)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
