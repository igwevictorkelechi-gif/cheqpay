import { V1Error, withApi } from "@/lib/devapi/handler";
import { eventObject, getEvent } from "@/lib/devapi/events";
import { resolveId } from "@/lib/devapi/inputs";

export const dynamic = "force-dynamic";

/** One event, exactly as it was delivered to your webhooks. */
export const GET = withApi({ scope: "events:read" }, async (ctx, params) => {
  const id = resolveId("event", params.id, "id", "event");
  const event = await getEvent(ctx.scope, id);
  if (!event) throw new V1Error(404, "No such event.", "not_found", "id");
  return { body: eventObject(event) };
});
