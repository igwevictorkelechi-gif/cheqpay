import { jsonOk, toErrorResponse } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
import { sendKycReminders } from "@/lib/kycReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily reminder to people who signed up but never verified their identity.
 * See lib/kycReminders.ts for who is picked and how often.
 */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    const result = await sendKycReminders();
    return jsonOk({ ran: true, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
