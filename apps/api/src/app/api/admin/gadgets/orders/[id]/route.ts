import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { refundOrder, setOrderStatus } from "@/lib/gadgetsAdmin";
import { GadgetOrderStatus } from "@cheqpay/db";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.nativeEnum(GadgetOrderStatus),
});

/**
 * Admin: move an order along. Fulfilment states (PROCESSING/SHIPPED/DELIVERED)
 * just update the status; CANCELLED/REFUNDED go through the money-safe refund
 * path, which returns the money and restores stock in one transaction.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const { status } = patchSchema.parse(await req.json());

    if (status === GadgetOrderStatus.CANCELLED || status === GadgetOrderStatus.REFUNDED) {
      const order = await refundOrder(params.id, status);
      return jsonOk({ order });
    }
    if (status === GadgetOrderStatus.PAID) {
      throw new ApiError(422, "PAID is the initial state and can't be set manually.", "bad_status");
    }
    const order = await setOrderStatus(params.id, status);
    return jsonOk({ order });
  } catch (err) {
    return toErrorResponse(err);
  }
}
