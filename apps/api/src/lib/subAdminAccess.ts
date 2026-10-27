// apps/api/src/lib/subAdminAccess.ts

import { type AdminSection, sectionForPath } from "./adminSections";

/**
 * What a sub admin (a dashboard session whose role isn't "super") may call:
 * the Dashboard and Analytics data, read-only; their own account (password,
 * authenticator, who-am-I); and every path of the sections a Super Admin has
 * granted them. Checked by requireAdmin on every call as well as in the
 * dashboard middleware, so a mistake in one of the ~45 dashboard proxies can't
 * widen what a sub admin sees.
 */
const SUB_ADMIN_READ_PATHS = ["/api/admin/analytics", "/api/admin/transactions", "/api/admin/live-map"];
const SUB_ADMIN_PASSWORD_PATH = "/api/admin/me/password";
/** Their own account: open before the password is changed, to see what's left to do. */
const SUB_ADMIN_ME_PATH = "/api/admin/me";
/** Their own authenticator, and their own alert subscriptions. */
const SUB_ADMIN_OWN_PATHS = ["/api/admin/me/otp", "/api/admin/push"];

export function subAdminMayCall(
  method: string,
  pathname: string,
  mustChange: boolean,
  sections: readonly AdminSection[] = [],
): boolean {
  if (pathname === SUB_ADMIN_PASSWORD_PATH) return true;
  if (pathname === SUB_ADMIN_ME_PATH) return method === "GET" || method === "HEAD";
  if (mustChange) return false;
  if (SUB_ADMIN_OWN_PATHS.includes(pathname)) return true;
  const section = sectionForPath(pathname);
  if (section && sections.includes(section)) return true;
  return (method === "GET" || method === "HEAD") && SUB_ADMIN_READ_PATHS.includes(pathname);
}
