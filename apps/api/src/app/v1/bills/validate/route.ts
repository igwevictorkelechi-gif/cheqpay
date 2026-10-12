import { withApi } from "@/lib/devapi/handler";
import { billValidateSchema, validateBillCustomer } from "@/lib/devapi/bills";

export const dynamic = "force-dynamic";

/** Check a customer number (meter, smartcard, phone) with the biller before paying. Moves no money. */
export const POST = withApi(
  { scope: "bills:write", body: billValidateSchema, logFields: ["service", "biller_id"] },
  (ctx) => validateBillCustomer(ctx),
);
