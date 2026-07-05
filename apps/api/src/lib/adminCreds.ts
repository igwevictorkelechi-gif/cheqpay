import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@cheqpay/db";

// Dashboard login credential for the admin app. Stored in platform_settings so
// it can be changed at runtime from the admin profile page. Until it's changed,
// a default (overridable via env) is used as a first-run bootstrap.
const EMAIL_KEY = "admin_login_email";
const HASH_KEY = "admin_login_pass";

export function defaultAdminEmail(): string {
  return (process.env.ADMIN_DEFAULT_EMAIL || "admin@cheqpay.com").toLowerCase();
}
function defaultAdminPassword(): string {
  return process.env.ADMIN_DEFAULT_PASSWORD || "CheqPayAdmin!2026";
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
  if (!storedHash) return password === defaultAdminPassword();
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
