// apps/api/src/lib/subAdminAccess.ts

/**
 * What a sub admin (a dashboard session whose role isn't "super") may call:
 * the Dashboard and Analytics data, read-only, and their own password change.
 * Checked by requireAdmin on every call as well as in the dashboard middleware, so a mistake in one
 * of the ~45 dashboard proxies can't widen what a sub admin sees.
 */
const SUB_ADMIN_READ_PATHS = ["/api/admin/analytics", "/api/admin/transactions"];
const SUB_ADMIN_PASSWORD_PATH = "/api/admin/me/password";

export function subAdminMayCall(method: string, pathname: string, mustChange: boolean): boolean {
  if (pathname === SUB_ADMIN_PASSWORD_PATH) return true;
  if (mustChange) return false;
  return (method === "GET" || method === "HEAD") && SUB_ADMIN_READ_PATHS.includes(pathname);
}
