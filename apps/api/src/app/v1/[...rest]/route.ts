import { randomUUID } from "node:crypto";
import { toPublicId } from "@cheqpay/devapi";
import { jsonResponse } from "@/lib/devapi/handler";

export const dynamic = "force-dynamic";

/** Unknown /v1 paths answer in the API's own error format, not an HTML page. */
function notFound(): Response {
  const requestId = toPublicId("request", randomUUID());
  return jsonResponse(
    404,
    {
      error: {
        type: "invalid_request_error",
        code: "not_found",
        message: "No such endpoint. See https://developers.mycheqpay.com/docs/api for the API reference.",
        param: null,
        request_id: requestId,
      },
    },
    { "x-request-id": requestId },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
