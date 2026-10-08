// apps/api/src/lib/devapi/dashboard.ts
//
// Shared pieces for the developer dashboard's routes (/api/developer/*). These
// are signed in with the owner's CheqPay session, never with an API key: a key
// can use the API, but it can't mint keys, change webhooks or move money out.
//
// Step-up: anything sensitive in live mode needs the session to have passed
// 2FA (Supabase AAL2), and anything that moves money also needs the
// transaction PIN. A stolen session token alone can then do no live damage.

import { requireUser, type AuthUser } from "../auth";
import { ApiError } from "../http";
import { assertFeatureEnabled } from "../features";
import { requestContext } from "../requestContext";
import { getAccountForOwner } from "./accounts";
import type { AccountRow } from "./types";

export interface DeveloperSession {
  user: AuthUser;
  account: AccountRow;
  ip: string | null;
  userAgent: string | null;
}

/** The signed-in owner and their developer account (404 if they haven't opened one). */
export async function requireDeveloper(req: Request): Promise<DeveloperSession> {
  await assertFeatureEnabled("developer_api");
  const user = await requireUser(req);
  const account = await getAccountForOwner(user.id);
  if (!account) throw new ApiError(404, "Open a developer account first.", "no_developer_account");
  const { ip, userAgent } = requestContext(req);
  return { user, account, ip, userAgent };
}

/** Refuse unless this session has passed two-factor authentication. */
export function requireStepUp(user: AuthUser): void {
  if (user.aal !== "aal2") {
    throw new ApiError(
      403,
      "Confirm with your authenticator app to do this. Turn on two-factor authentication in your account if you haven't.",
      "mfa_required",
    );
  }
}

export function actorOf(s: Pick<DeveloperSession, "user" | "ip" | "userAgent">) {
  return { userId: s.user.id, ip: s.ip, userAgent: s.userAgent };
}
