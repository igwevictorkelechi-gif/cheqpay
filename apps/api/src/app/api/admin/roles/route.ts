import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const KEY = "admin_emails";

/** Admin emails defined via the ADMIN_EMAILS env var (read-only here). */
function envAdmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Admin emails managed in the DB (platform_settings). */
async function readList(): Promise<string[]> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/** Admin: list managed admins + env-defined admins. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ admins: await readList(), envAdmins: envAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: replace the managed admin allowlist. */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const updatedBy = req.headers.get("x-admin-actor") ?? "admin";
    const body = (await req.json()) as { emails?: unknown };
    const emails = Array.isArray(body.emails)
      ? Array.from(
          new Set(
            body.emails
              .map((e) => String(e).trim().toLowerCase())
              .filter((e) => e.includes("@")),
          ),
        )
      : [];
    await prisma.platformSetting.upsert({
      where: { key: KEY },
      update: { value: JSON.stringify(emails), updatedBy },
      create: { key: KEY, value: JSON.stringify(emails), updatedBy },
    });
    return jsonOk({ admins: emails, envAdmins: envAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
