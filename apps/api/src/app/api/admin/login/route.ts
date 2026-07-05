import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { verifyAdminLogin, getAdminEmail } from "@/lib/adminCreds";

export const dynamic = "force-dynamic";

/**
 * Verify admin dashboard credentials. Public (this IS the login) but rate
 * limited. Returns the canonical admin email on success. The admin app turns a
 * success into its own signed session cookie.
 */
export async function POST(req: Request) {
  try {
    enforceRateLimit("admin:login", 10, 60_000);
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");

    if (!email || !password) {
      return jsonOk({ error: "Email and password are required", code: "missing" }, 400);
    }
    if (!(await verifyAdminLogin(email, password))) {
      return jsonOk({ error: "Invalid email or password", code: "bad_credentials" }, 401);
    }
    return jsonOk({ ok: true, email: await getAdminEmail() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
