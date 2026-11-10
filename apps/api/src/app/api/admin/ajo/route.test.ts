import { beforeEach, describe, expect, it, vi } from "vitest";

/** The admin Ajo view is behind the "ajo" section grant, and read-only. */

const h = vi.hoisted(() => ({ actor: vi.fn(), overview: vi.fn(), groups: vi.fn(), debtors: vi.fn() }));

vi.mock("@/lib/adminGuard", () => ({ requireAdminActor: h.actor }));
vi.mock("@/lib/ajo/admin", () => ({
  ajoAdminOverview: h.overview,
  listAjoGroupsAdmin: h.groups,
  listAjoDebtorsAdmin: h.debtors,
}));

import { GET as overview } from "./route";
import { GET as groups } from "./groups/route";
import { GET as debtors } from "./debtors/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ email: "ops@x", role: "sub", sections: ["ajo"] });
  h.overview.mockResolvedValue({ plans: {}, groups: {}, arrears: {}, dueNext24h: {} });
  h.groups.mockResolvedValue([]);
  h.debtors.mockResolvedValue([]);
});

describe("admin Ajo routes", () => {
  it("ask for the ajo section on every route", async () => {
    await overview(new Request("https://x/api/admin/ajo"));
    await groups(new Request("https://x/api/admin/ajo/groups?status=arrears"));
    await debtors(new Request("https://x/api/admin/ajo/debtors"));
    for (const call of h.actor.mock.calls) expect(call[1]).toEqual({ section: "ajo" });
    expect(h.actor).toHaveBeenCalledTimes(3);
  });

  it("refuse an admin without the grant before touching data", async () => {
    const { ApiError } = await import("@/lib/http");
    h.actor.mockRejectedValue(new ApiError(403, "Not allowed", "forbidden"));
    const res = await overview(new Request("https://x/api/admin/ajo"));
    expect(res.status).toBe(403);
    expect(h.overview).not.toHaveBeenCalled();
  });

  it("fall back to the active groups for an unknown filter", async () => {
    await groups(new Request("https://x/api/admin/ajo/groups?status=nonsense"));
    expect(h.groups).toHaveBeenCalledWith("active");
    await groups(new Request("https://x/api/admin/ajo/groups?status=ARREARS"));
    expect(h.groups).toHaveBeenCalledWith("arrears");
  });
});
