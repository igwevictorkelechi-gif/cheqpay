import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getCustomer, getCustomerAccounts, hasTier1Evidence } from "@/lib/maplerad/customers";
import { ensureMapleradSchema } from "@/lib/mapleradCustomer";
import { redactMapleradCustomer, storeMapleradCustomerSnapshot } from "@/lib/mapleradSnapshots";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin-only: pull a Maplerad customer and its accounts and store a snapshot.
 *
 * This is the on-demand version of what the enrolment reconcile does as a side
 * effect: GET /customers/{id} and GET /customers/{id}/accounts, both through the
 * egress proxy and secret this server holds (and both logged by the Maplerad
 * client). The redacted customer plus its accounts are written to
 * maplerad_customer_snapshots, and if a user is linked to this customer id its
 * tier is reconciled up from the evidence Maplerad actually holds.
 *
 * Why an endpoint and not a script: only the deployed server has the secret and
 * a whitelisted egress IP. Auth is requireAdmin (x-admin-secret or an admin JWT).
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    if (!id) throw new ApiError(400, "Missing customer id", "no_customer_id");

    const detail = await getCustomer(id);
    // GET /customers/{id}/accounts is best-effort: a customer with no accounts
    // yet (tier 0) still yields a useful customer snapshot.
    let accounts: unknown[] = [];
    try {
      accounts = await getCustomerAccounts(id);
    } catch (err) {
      console.error("[maplerad] could not fetch customer accounts", {
        customerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // GET /customers carries no tier field, so it is inferred from whether the
    // evidence a tier-1 upgrade needs is already on the record.
    const tier = hasTier1Evidence(detail) ? 1 : 0;
    const snapshotId = await storeMapleradCustomerSnapshot(id, tier, detail, accounts);

    // Reconcile the tier onto a user linked to this customer, never downgrading.
    await ensureMapleradSchema();
    const updated = await prisma.$executeRaw`
      UPDATE app_users SET maplerad_tier = GREATEST(maplerad_tier, ${tier})
      WHERE maplerad_customer_id = ${id}`;

    return jsonOk({
      customerId: id,
      snapshotId,
      tier,
      hasTier1Evidence: tier >= 1,
      accountsFetched: accounts.length,
      linkedUserUpdated: updated > 0,
      customer: redactMapleradCustomer(detail),
      accounts,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
