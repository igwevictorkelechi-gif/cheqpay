import { openapiDocument } from "@cheqpay/devapi/openapi";

export const dynamic = "force-static";

/** The OpenAPI 3.1 document, as a file you can import into Postman or a code generator. */
export function GET() {
  return new Response(JSON.stringify(openapiDocument, null, 2), { headers: { "content-type": "application/json" } });
}
