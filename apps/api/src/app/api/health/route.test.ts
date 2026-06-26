import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("cheqpay-api");
    expect(typeof body.time).toBe("string");
    expect(typeof body.uptimeSeconds).toBe("number");
  });
});
