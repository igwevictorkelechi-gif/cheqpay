// Creator applications: the form's rules (always), and the review round-trip
// against a real Postgres (DEVAPI_DB_TESTS=1).
//
//   DEVAPI_DB_TESTS=1 DATABASE_URL=postgresql://… npx vitest run src/lib/creatorApplications.int.test.ts

import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@cheqpay/db";

vi.mock("./alerts", () => ({ notifyUser: vi.fn(async () => ({ devices: 0, browsers: 0, email: false })) }));

import {
  applicationSchema,
  canSubmit,
  codeAvailability,
  decideApplication,
  getApplication,
  getApplicationAdmin,
  listApplicationsAdmin,
  submitApplication,
} from "./creatorApplications";
import { notifyUser } from "./alerts";

const RUN = process.env.DEVAPI_DB_TESTS === "1";

const good = () => ({
  phone: "+234 803 000 0000",
  socials: [{ platform: "instagram", handle: "@ada.obi", followers: "10k-50k" }],
  niches: ["Finance", "Lifestyle"],
  audienceLocation: "Lagos",
  avgViews: "5k-20k",
  sampleLinks: ["https://www.instagram.com/p/abc123/"],
  bio: "I make short videos about money for young Nigerians.",
  priorBrands: "",
  why: "I already use CheqPay to pay my bills.",
  agreeTerms: true,
});

describe("the application form's rules", () => {
  it("accepts a good application, cleans the handle and builds the profile link", () => {
    const a = applicationSchema.parse(good());
    expect(a.socials[0]).toEqual({ platform: "instagram", handle: "ada.obi", followers: "10k-50k", url: "https://www.instagram.com/ada.obi" });
  });

  it("needs the terms ticked", () => {
    expect(applicationSchema.safeParse({ ...good(), agreeTerms: false }).success).toBe(false);
    const { agreeTerms: _, ...rest } = good();
    expect(applicationSchema.safeParse(rest).success).toBe(false);
  });

  it("only takes https links on the platform's own site", () => {
    const withUrl = (url: string) => applicationSchema.safeParse({ ...good(), socials: [{ ...good().socials[0], url }] }).success;
    expect(withUrl("https://instagram.com/ada.obi")).toBe(true);
    expect(withUrl("http://instagram.com/ada.obi")).toBe(false);
    expect(withUrl("https://instagram.com.evil.example/ada")).toBe(false);
    expect(withUrl("https://evil.example/instagram.com")).toBe(false);
    expect(withUrl("javascript:alert(1)")).toBe(false);
    expect(withUrl("https://user:pw@instagram.com/x")).toBe(false);
  });

  it("only takes recent posts on social sites, or the creator's own listed site", () => {
    const posts = (sampleLinks: string[], socials = good().socials) => applicationSchema.safeParse({ ...good(), socials, sampleLinks }).success;
    expect(posts(["https://vm.tiktok.com/ZM123/"])).toBe(true);
    expect(posts(["https://example.com/post"])).toBe(false);
    expect(posts(["https://blog.ada.ng/post/1"], [...good().socials, { platform: "other", handle: "My blog", followers: "<1k", url: "https://ada.ng" } as never])).toBe(true);
    expect(posts([])).toBe(false);
    expect(posts(["https://x.com/a/1", "https://x.com/a/2", "https://x.com/a/3", "https://x.com/a/4"])).toBe(false);
  });

  it("sticks to the fixed bands, topics and lengths", () => {
    expect(applicationSchema.safeParse({ ...good(), avgViews: "1000000" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), socials: [{ ...good().socials[0], followers: 5000 }] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), niches: ["Finance", "Tech", "Crypto", "Music"] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), niches: ["Hacking"] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), bio: "x".repeat(501) }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), extra: 1 }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), socials: [good().socials[0], good().socials[0]] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...good(), socials: [{ ...good().socials[0], handle: "ada obi<script>" }] }).success).toBe(false);
  });

  it("knows when a creator may send it in", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(canSubmit(null, now)).toBe(true);
    expect(canSubmit({ status: "PENDING", reapply_after: null }, now)).toBe(false);
    expect(canSubmit({ status: "APPROVED", reapply_after: null }, now)).toBe(false);
    expect(canSubmit({ status: "NEEDS_INFO", reapply_after: null }, now)).toBe(true);
    expect(canSubmit({ status: "REJECTED", reapply_after: new Date("2026-10-09T00:00:00Z") }, now)).toBe(false);
    expect(canSubmit({ status: "REJECTED", reapply_after: new Date("2026-10-08T00:00:00Z") }, now)).toBe(true);
  });
});

describe.skipIf(!RUN)("applying and review, against the database", () => {
  async function user(kycTier: number, extra: Record<string, unknown> = {}) {
    const email = `creator-${randomBytes(4).toString("hex")}@x.test`;
    return prisma.user.create({ data: { email, kycTier, legalName: kycTier ? "ADA OBI" : null, ...extra } });
  }
  const input = () => applicationSchema.parse(good());
  const appId = async (userId: string) => (await getApplication(userId)).application!.id;

  beforeAll(async () => {
    await getApplication((await user(1)).id); // creates the tables
  });

  it("asks for verified identity first", async () => {
    const u = await user(0);
    const g = await getApplication(u.id);
    expect(g.me.verified).toBe(false);
    await expect(submitApplication(u.id, input())).rejects.toMatchObject({ code: "verify_identity_first" });
  });

  it("uses the verified legal name, not a typed one, and records KYC as it stood", async () => {
    const u = await user(2);
    await submitApplication(u.id, input());
    const g = await getApplication(u.id);
    expect(g.application).toMatchObject({ fullName: "ADA OBI", status: "PENDING", niches: ["Finance", "Lifestyle"], audienceLocation: "Lagos" });
    expect(g.canSubmit).toBe(false);
    const admin = await getApplicationAdmin(g.application!.id);
    expect(admin.application).toMatchObject({ kycTierAtApply: 2, legalNameAtApply: "ADA OBI" });
    expect(admin.application.termsAcceptedAt).not.toBeNull();
    expect(notifyUser).toHaveBeenCalled();
  });

  it("refuses a second submission while it's being reviewed", async () => {
    const u = await user(1);
    await submitApplication(u.id, input());
    await expect(submitApplication(u.id, input())).rejects.toMatchObject({ code: "already_applied" });
  });

  it("round-trips 'needs more info' back to pending", async () => {
    const u = await user(1);
    await submitApplication(u.id, input());
    const id = await appId(u.id);
    await decideApplication(id, "admin@x", { action: "request_info", note: "Please add your TikTok." });
    let g = await getApplication(u.id);
    expect(g.application).toMatchObject({ status: "NEEDS_INFO", requestNote: "Please add your TikTok." });
    expect(g.canSubmit).toBe(true);
    expect((await listApplicationsAdmin("NEEDS_INFO")).some((a) => a.id === id)).toBe(true);
    // Can't ask twice while it's with the creator.
    await expect(decideApplication(id, "admin@x", { action: "request_info", note: "And more" })).rejects.toMatchObject({ code: "already_decided" });

    await submitApplication(u.id, applicationSchema.parse({ ...good(), socials: [...good().socials, { platform: "tiktok", handle: "adaobi", followers: "1k-10k" }] }));
    g = await getApplication(u.id);
    expect(g.application).toMatchObject({ status: "PENDING", submissions: 2 });
    expect(g.application!.socials).toHaveLength(2);
  });

  it("makes a rejected creator wait before applying again", async () => {
    const u = await user(1);
    await submitApplication(u.id, input());
    const id = await appId(u.id);
    await decideApplication(id, "admin@x", { action: "reject", reason: "Audience too small for now." });
    const g = await getApplication(u.id);
    expect(g.application!.status).toBe("REJECTED");
    expect(new Date(g.application!.reapplyAfter!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await expect(submitApplication(u.id, input())).rejects.toMatchObject({ code: "reapply_not_yet" });
    await prisma.$executeRawUnsafe(`UPDATE influencer_applications SET reapply_after = now() - interval '1 minute' WHERE id = $1::uuid`, id);
    await submitApplication(u.id, input());
    expect((await getApplication(u.id)).application!.status).toBe("PENDING");
  });

  it("approves once, makes them a creator with their code, and checks codes live", async () => {
    const u = await user(1);
    const code = `C${randomBytes(4).toString("hex").toUpperCase()}`;
    expect(await codeAvailability(u.id, code)).toEqual({ code, available: true });
    expect((await codeAvailability(u.id, "ab")).available).toBe(false);
    await submitApplication(u.id, { ...input(), preferredCode: code });
    const id = await appId(u.id);

    const other = await user(1);
    expect(await codeAvailability(other.id, code)).toMatchObject({ available: true }); // only a request, not taken yet

    const results = await Promise.allSettled([
      decideApplication(id, "a@x", { action: "approve", code, commissionPercent: 20, windowDays: 90 }),
      decideApplication(id, "b@x", { action: "reject", reason: "Not a fit." }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const g = await getApplication(u.id);
    if (g.application!.status === "APPROVED") {
      expect(g.isInfluencer).toBe(true);
      expect(await codeAvailability(other.id, code)).toMatchObject({ available: false });
      await expect(submitApplication(other.id, { ...input(), preferredCode: code })).rejects.toMatchObject({ code: "code_taken" });
      await expect(submitApplication(u.id, input())).rejects.toMatchObject({ code: "already_influencer" });
    }
  });

  it("shows the admin the facts to vet with", async () => {
    const fp = `fp-${randomBytes(6).toString("hex")}`;
    const u = await user(1, { bvnFingerprint: fp });
    await user(1, { bvnFingerprint: fp }); // a second account on the same BVN
    const twin = await user(1);
    const digits = String(Math.floor(1e9 + Math.random() * 9e9)).slice(0, 9);
    await submitApplication(u.id, { ...input(), phone: `+234 8${digits}` });
    await submitApplication(twin.id, { ...input(), phone: `08${digits}` }); // same number, written differently
    const v = (await getApplicationAdmin(await appId(u.id))).vetting;
    expect(v).toMatchObject({ kycTier: 1, legalName: "ADA OBI", accountStatus: "ACTIVE", bvnSharedWith: 1, referredBy: null });
    expect(v.phoneMatches.some((m) => m.email === twin.email)).toBe(true);
    expect((await listApplicationsAdmin("ALL", twin.email)).map((a) => a.email)).toEqual([twin.email]);
  });
});
