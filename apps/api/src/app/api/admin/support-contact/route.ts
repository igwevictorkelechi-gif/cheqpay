import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { supportContactUpdateSchema } from "@/lib/validation";
import { getSupportContact, setSupportContact } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Admin: read the public support contact details. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk(await getSupportContact());
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: update the support contact details (email, phone, WhatsApp). */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const updatedBy = req.headers.get("x-admin-actor") ?? "admin";
    const patch = supportContactUpdateSchema.parse(await req.json());
    await setSupportContact(patch, updatedBy);
    return jsonOk(await getSupportContact());
  } catch (err) {
    return toErrorResponse(err);
  }
}
