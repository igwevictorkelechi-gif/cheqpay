// apps/api/src/lib/devapi/dashboardWebhooks.ts
//
// Shared pieces for the dashboard's webhook routes: find the endpoint by its
// public id (only within the signed-in owner's account), and require 2FA for
// anything that changes where live events go.

import { fromPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { requireStepUp, type DeveloperSession } from "./dashboard";
import { getEndpoint } from "./webhooks";
import type { EndpointRow, Mode } from "./types";

export async function endpointFor(s: DeveloperSession, publicId: string): Promise<EndpointRow> {
  const id = fromPublicId("webhook_endpoint", publicId);
  const endpoint = id ? await getEndpoint(s.account.id, id) : null;
  if (!endpoint) throw new ApiError(404, "No such webhook endpoint.", "not_found");
  return endpoint;
}

/** Live webhook changes redirect real customer data: they need a 2FA-confirmed session. */
export function stepUpForLive(s: DeveloperSession, mode: Mode): void {
  if (mode === "live") requireStepUp(s.user);
}
