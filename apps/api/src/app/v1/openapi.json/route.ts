import { openapiDocument } from "@cheqpay/devapi/openapi";

export const dynamic = "force-static";

/** The machine-readable API reference (OpenAPI 3.1). Public: it describes the API, it grants nothing. */
export function GET(): Response {
  return new Response(JSON.stringify(openapiDocument, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
