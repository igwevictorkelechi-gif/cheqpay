import { withApi } from "@/lib/devapi/handler";
import { eventObject, listEvents } from "@/lib/devapi/events";

export const dynamic = "force-dynamic";

/** The last 30 days of events in this mode, newest first: the polling fallback for webhooks. */
export const GET = withApi({ scope: "events:read" }, async (ctx) => {
  const page = await listEvents(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(eventObject) } };
});
