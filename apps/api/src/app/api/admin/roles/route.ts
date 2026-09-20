import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const KEY = "admin_emails";

export type AdminRole = "admin" | "super";
export interface ManagedAdmin {
  email: string;
  role: AdminRole;
}

/** Admin emails defined via the ADMIN_EMAILS env var — always Super Admins. */
function envAdmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Managed admins from platform_settings, each with a role.
 *
 * Back-compatible: the value used to be a plain array of email strings, which
 * we read as regular admins ({ role: "admin" }).
 */
async function readList(): Promise<ManagedAdmin[]> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ManagedAdmin[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      let email = "";
      let role: AdminRole = "admin";
      if (typeof entry === "string") {
        email = entry;
      } else if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        email = typeof e.email === "string" ? e.email : "";
        role = e.role === "super" ? "super" : "admin";
      }
      email = email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, role });
    }
    return out;
  } catch {
    return [];
  }
}

/** Admin: list managed admins (with roles) + env-defined super admins. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ admins: await readList(), envAdmins: envAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: replace the managed admin list.
 *
 * Accepts { admins: [{ email, role }] } (new) or { emails: [string] } (legacy,
 * all treated as regular admins). Env admins are never stored here — they are
 * always super and immutable.
 */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const updatedBy = req.headers.get("x-admin-actor") ?? "admin";
    const body = (await req.json()) as { admins?: unknown; emails?: unknown };

    const env = new Set(envAdmins());
    const seen = new Set<string>();
    const admins: ManagedAdmin[] = [];

    const rawList: unknown[] = Array.isArray(body.admins)
      ? body.admins
      : Array.isArray(body.emails)
        ? body.emails
        : [];

    for (const entry of rawList) {
      let email = "";
      let role: AdminRole = "admin";
      if (typeof entry === "string") {
        email = entry;
      } else if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        email = typeof e.email === "string" ? e.email : "";
        role = e.role === "super" ? "super" : "admin";
      }
      email = email.trim().toLowerCase();
      // Env admins are already super and immutable; don't duplicate them here.
      if (!email.includes("@") || env.has(email) || seen.has(email)) continue;
      seen.add(email);
      admins.push({ email, role });
    }

    await prisma.platformSetting.upsert({
      where: { key: KEY },
      update: { value: JSON.stringify(admins), updatedBy },
      create: { key: KEY, value: JSON.stringify(admins), updatedBy },
    });
    return jsonOk({ admins, envAdmins: envAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
