import { beforeEach, describe, expect, it, vi } from "vitest";

// A Super Admin decides which dashboard sections a sub admin may open, and can
// reset a sub admin's lost authenticator. Both are grants of trust: Super Admin
// only, a fresh code, and an audit line naming what changed.

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  otp: vi.fn(),
  record: vi.fn(),
  list: vi.fn(),
  setSections: vi.fn(),
  resetOtp: vi.fn(),
}));

vi.mock("@/lib/adminGuard", () => ({
  requireAdminActor: h.actor,
  requireAdminOtp: h.otp,
  recordAdminAction: h.record,
}));
vi.mock("@/lib/adminCreds", () => ({
  listSubAdmins: h.list,
  setSubAdminSections: h.setSections,
  resetSubAdminOtp: h.resetOtp,
  deleteSubAdmin: vi.fn(),
  getAdminEmail: async () => "admin@cheqpay.com",
  isStrongAdminPassword: () => true,
  setSubAdminPassword: vi.fn(),
}));

import { ForbiddenError } from "@/lib/http";
import { PATCH } from "./route";

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("https://api.example/api/admin/sub-admins", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ email: "admin@cheqpay.com", role: "super", sections: [] });
  h.list.mockResolvedValue([{ email: "sub@x.com", status: "active", sections: ["users"], otpEnrolled: true }]);
  h.setSections.mockResolvedValue(true);
});

describe("PATCH /api/admin/sub-admins", () => {
  it("sets the sections, with a code, and records what was granted and removed", async () => {
    const res = await patch({ email: "Sub@x.com", sections: ["giftcards", "bogus"], otp: "123456" });
    expect(res.status).toBe(200);
    expect(h.actor).toHaveBeenCalledWith(expect.anything(), { superOnly: true });
    expect(h.otp).toHaveBeenCalledWith(expect.anything(), "123456");
    expect(h.setSections).toHaveBeenCalledWith("sub@x.com", ["giftcards"]);
    expect(h.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "admin.subadmin.access_changed",
        details: expect.objectContaining({ added: ["giftcards"], removed: ["users"] }),
      }),
    );
  });

  it("resets a lost authenticator", async () => {
    const res = await patch({ email: "sub@x.com", resetAuthenticator: true });
    expect(res.status).toBe(200);
    expect(h.resetOtp).toHaveBeenCalledWith("sub@x.com");
    expect(h.setSections).not.toHaveBeenCalled();
  });

  it("is for Super Admins only", async () => {
    h.actor.mockRejectedValue(new ForbiddenError("Only a Super Admin can do this."));
    const res = await patch({ email: "sub@x.com", sections: ["giftcards"] });
    expect(res.status).toBe(403);
    expect(h.setSections).not.toHaveBeenCalled();
  });

  it("refuses an unknown sub admin before asking for a code", async () => {
    const res = await patch({ email: "ghost@x.com", sections: ["giftcards"] });
    expect(res.status).toBe(404);
    expect(h.otp).not.toHaveBeenCalled();
  });
});
