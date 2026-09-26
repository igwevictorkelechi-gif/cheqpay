import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@cheqpay/db";

// Dashboard login credential for the admin app. Stored in platform_settings so
// it can be changed at runtime from the admin profile page.
//
// There is NO built-in default password. There used to be one, written right
// here in a public repository, and it stayed valid until someone changed it —
// which is how the 22 Sep 2026 incident began. A fresh deployment now signs in
// only with ADMIN_DEFAULT_PASSWORD from the environment (set it, sign in, change
// it), and with no stored password and no env value, nobody can sign in at all.
const EMAIL_KEY = "admin_login_email";
const HASH_KEY = "admin_login_pass";

/** Passwords that have ever been published in this codebase. Never accepted. */
const PUBLISHED_PASSWORDS = new Set(["CheqPayAdmin!2026"]);

export function defaultAdminEmail(): string {
  return (process.env.ADMIN_DEFAULT_EMAIL || "admin@cheqpay.com").toLowerCase();
}
function bootstrapPassword(): string | null {
  const p = process.env.ADMIN_DEFAULT_PASSWORD ?? "";
  if (p.length < 12 || PUBLISHED_PASSWORDS.has(p)) return null;
  return p;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const dk = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** The current admin login email (stored, else default). */
export async function getAdminEmail(): Promise<string> {
  return (await getSetting(EMAIL_KEY))?.toLowerCase() || defaultAdminEmail();
}

/** True when the credential is still the un-changed default (password not set). */
export async function isDefaultCredential(): Promise<boolean> {
  return !(await getSetting(HASH_KEY));
}

/** Verify a login against the stored credential, or the default if none stored. */
export async function verifyAdminLogin(email: string, password: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const storedHash = await getSetting(HASH_KEY);
  const expectedEmail = (await getSetting(EMAIL_KEY))?.toLowerCase() || defaultAdminEmail();
  if (e !== expectedEmail) return false;
  if (PUBLISHED_PASSWORDS.has(password)) return false;
  if (!storedHash) {
    const boot = bootstrapPassword();
    if (!boot) return false;
    const a = Buffer.from(password);
    const b = Buffer.from(boot);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return verifyPassword(password, storedHash);
}

/** Update the admin email and/or password. */
export async function setAdminCredential(
  input: { email?: string; password?: string },
  updatedBy?: string
): Promise<void> {
  const ops = [];
  if (input.email) {
    const email = input.email.trim().toLowerCase();
    ops.push(
      prisma.platformSetting.upsert({
        where: { key: EMAIL_KEY },
        update: { value: email, updatedBy },
        create: { key: EMAIL_KEY, value: email, updatedBy },
      })
    );
  }
  if (input.password) {
    const value = hashPassword(input.password);
    ops.push(
      prisma.platformSetting.upsert({
        where: { key: HASH_KEY },
        update: { value, updatedBy },
        create: { key: HASH_KEY, value, updatedBy },
      })
    );
  }
  await prisma.$transaction(ops);
}

// ---------------------------------------------------------------------------
// Sub admins.
//
// A sub admin signs in with their own email and a password a Super Admin set
// for them, and must replace it on first sign-in. They can only see the
// Dashboard and Analytics; `requireAdmin` enforces that on every call, and an
// account only works while its email is still on the Roles list as a regular
// admin, so removing someone there locks them out at once.
// ---------------------------------------------------------------------------

const ROLES_KEY = "admin_emails";

/** Password rule shared by every admin password. */
export function isStrongAdminPassword(p: string): boolean {
  return p.length >= 12 && p.length <= 200 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

let accountsReady: Promise<void> | null = null;
export function ensureAdminAccountsTable(): Promise<void> {
  if (!accountsReady) {
    accountsReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS admin_accounts (
          email text PRIMARY KEY,
          password_hash text NOT NULL,
          must_change boolean NOT NULL DEFAULT true,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          password_changed_at timestamptz
        )`);
    })().catch((err) => {
      accountsReady = null;
      throw err;
    });
  }
  return accountsReady;
}

interface AccountRow {
  email: string;
  password_hash: string;
  must_change: boolean;
  created_at: Date;
  password_changed_at: Date | null;
}

async function readAccount(email: string): Promise<AccountRow | null> {
  await ensureAdminAccountsTable();
  const rows = await prisma.$queryRaw<AccountRow[]>`
    SELECT email, password_hash, must_change, created_at, password_changed_at
    FROM admin_accounts WHERE email = ${email.trim().toLowerCase()}`;
  return rows[0] ?? null;
}

/** Emails on the Roles list with the regular (non-super) role. */
export async function listSubAdminEmails(): Promise<string[]> {
  const raw = await getSetting(ROLES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry.trim().toLowerCase();
        if (entry && typeof entry === "object") {
          const e = entry as { email?: unknown; role?: unknown };
          return e.role === "super" ? "" : String(e.email ?? "").trim().toLowerCase();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface SubAdminState {
  active: boolean;
  mustChange: boolean;
}

/** Whether a sub admin may use the dashboard right now, and if they must change password. */
export async function getSubAdminState(email: string): Promise<SubAdminState> {
  const e = email.trim().toLowerCase();
  if (!(await listSubAdminEmails()).includes(e)) return { active: false, mustChange: false };
  const acct = await readAccount(e);
  if (!acct) return { active: false, mustChange: false };
  return { active: true, mustChange: acct.must_change };
}

/** Check a sub admin's sign-in. Null when it isn't a working sub-admin login. */
export async function verifySubAdminLogin(
  email: string,
  password: string,
): Promise<{ email: string; mustChange: boolean } | null> {
  const e = email.trim().toLowerCase();
  const acct = await readAccount(e);
  if (!acct) {
    // Same work as a real check, so a missing account can't be told apart by timing.
    verifyPassword(password, `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`);
    return null;
  }
  if (!verifyPassword(password, acct.password_hash)) return null;
  if (!(await listSubAdminEmails()).includes(e)) return null;
  return { email: e, mustChange: acct.must_change };
}

/**
 * Set a sub admin's password (create or reset) and add them to the Roles list.
 * They must replace it the next time they sign in.
 */
export async function setSubAdminPassword(email: string, password: string, by: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await ensureAdminAccountsTable();
  const hash = hashPassword(password);
  await prisma.$executeRaw`
    INSERT INTO admin_accounts (email, password_hash, must_change, created_by)
    VALUES (${e}, ${hash}, true, ${by})
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash, must_change = true, created_by = EXCLUDED.created_by`;

  const current = await readRoles();
  if (!current.some((a) => a.email === e)) {
    current.push({ email: e, role: "admin" });
    await writeRoles(current, by);
  }
}

/** A sub admin replaces their own password. False when the current one is wrong. */
export async function changeOwnSubAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const acct = await readAccount(e);
  if (!acct || !verifyPassword(currentPassword, acct.password_hash)) return false;
  const hash = hashPassword(newPassword);
  await prisma.$executeRaw`
    UPDATE admin_accounts
    SET password_hash = ${hash}, must_change = false, password_changed_at = now()
    WHERE email = ${e}`;
  return true;
}

/** Remove a sub admin: their password and their place on the Roles list. */
export async function deleteSubAdmin(email: string, by: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await ensureAdminAccountsTable();
  await prisma.$executeRaw`DELETE FROM admin_accounts WHERE email = ${e}`;
  const current = await readRoles();
  const next = current.filter((a) => a.email !== e);
  if (next.length !== current.length) await writeRoles(next, by);
}

export interface SubAdminInfo {
  email: string;
  status: "pending" | "active" | "no_password";
  createdAt: string | null;
  passwordChangedAt: string | null;
}

/** Every sub admin on the Roles list, with whether they've signed in and set their own password. */
export async function listSubAdmins(): Promise<SubAdminInfo[]> {
  await ensureAdminAccountsTable();
  const emails = await listSubAdminEmails();
  if (emails.length === 0) return [];
  const rows = await prisma.$queryRaw<AccountRow[]>`
    SELECT email, password_hash, must_change, created_at, password_changed_at
    FROM admin_accounts WHERE email = ANY(${emails})`;
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  return emails.map((email) => {
    const r = byEmail.get(email);
    return {
      email,
      status: !r ? "no_password" : r.must_change ? "pending" : "active",
      createdAt: r ? new Date(r.created_at).toISOString() : null,
      passwordChangedAt: r?.password_changed_at ? new Date(r.password_changed_at).toISOString() : null,
    };
  });
}

type RoleEntry = { email: string; role: "admin" | "super" };

async function readRoles(): Promise<RoleEntry[]> {
  const raw = await getSetting(ROLES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RoleEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string") out.push({ email: entry.trim().toLowerCase(), role: "admin" });
      else if (entry && typeof entry === "object") {
        const e = entry as { email?: unknown; role?: unknown };
        const email = String(e.email ?? "").trim().toLowerCase();
        if (email) out.push({ email, role: e.role === "super" ? "super" : "admin" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function writeRoles(list: RoleEntry[], by: string): Promise<void> {
  const value = JSON.stringify(list);
  await prisma.platformSetting.upsert({
    where: { key: ROLES_KEY },
    update: { value, updatedBy: by },
    create: { key: ROLES_KEY, value, updatedBy: by },
  });
}
