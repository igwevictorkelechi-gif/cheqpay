import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { billsOverview, saveBill } from "@/lib/savedBills";

export const dynamic = "force-dynamic";

/** Pay bills overview for a month: paid, cashback, still to sort, saved bills, suggestions. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("bill_payments");
    const month = new URL(req.url).searchParams.get("month") ?? undefined;
    return jsonOk(await billsOverview(auth.id, month));
  } catch (err) {
    return toErrorResponse(err);
  }
}

const saveSchema = z.object({
  service: z.string().min(2).max(20),
  billerId: z.string().min(1).max(40),
  customer: z.string().min(3).max(64),
  nickname: z.string().min(1).max(60),
  planId: z.string().max(80).nullable().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
});

/** Save a bill under the user's own name (or rename one already saved). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("bill_payments");
    await enforceRateLimit(`bills-saved:${auth.id}`, 30, 60_000);
    const id = await saveBill(auth.id, saveSchema.parse(await req.json()));
    return jsonOk({ id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
