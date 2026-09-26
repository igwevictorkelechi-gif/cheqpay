import { z } from "zod";
import { enforceRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/requestContext";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Crash reports from the web app's error screens.
 *
 * The site is uploaded as static files built without an error-reporting key,
 * so a crash in a customer's browser was invisible to us — "Something went
 * wrong" on an iPhone, and nothing to go on. The error screens now send the
 * error here and it is written to the API's logs. Nothing is stored.
 *
 * Public on purpose (a crash can happen before or after sign-in), so it is
 * rate-limited per address, size-capped, and keeps no query strings, which can
 * carry ids and tokens.
 */
const schema = z.object({
  message: z.string().max(500),
  name: z.string().max(100).optional(),
  stack: z.string().max(2_000).optional(),
  digest: z.string().max(100).optional(),
  path: z.string().max(200).optional(),
  userAgent: z.string().max(300).optional(),
});

const MAX_BODY = 4_096;

export async function POST(req: Request) {
  try {
    const ip = clientIp(req) ?? "unknown";
    await enforceRateLimit(`client-errors:${ip}`, 20, 60_000);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return jsonOk({ error: "Too large", code: "too_large" }, 413);
    let parsed: z.infer<typeof schema>;
    try {
      parsed = schema.parse(JSON.parse(raw || "{}"));
    } catch {
      return jsonOk({ error: "Invalid report", code: "invalid" }, 422);
    }

    const path = (parsed.path ?? "").split("?")[0].split("#")[0];
    console.error(
      "[client-error]",
      JSON.stringify({
        name: parsed.name ?? "Error",
        message: parsed.message,
        path,
        digest: parsed.digest,
        userAgent: parsed.userAgent ?? req.headers.get("user-agent")?.slice(0, 300),
        stack: parsed.stack?.split("\n").slice(0, 12).join("\n"),
      }),
    );
    return jsonOk({ ok: true }, 202);
  } catch (err) {
    return toErrorResponse(err);
  }
}
