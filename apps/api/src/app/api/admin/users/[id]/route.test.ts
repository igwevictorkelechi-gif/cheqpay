import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  findUnique,
  sessionFindMany,
  groupBy,
  txFindFirst,
  txCount,
  txFindMany,
  walletFindUnique,
  auditCreate,
  signKycDocumentUrl,
  resolveApiOrigin,
  ensureActivitySchema,
  ensureMapleradSchema,
  ensureKycDocSchema,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  groupBy: vi.fn(),
  txFindFirst: vi.fn(),
  txCount: vi.fn(),
  txFindMany: vi.fn(),
  walletFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  signKycDocumentUrl: vi.fn(),
  resolveApiOrigin: vi.fn(),
  ensureActivitySchema: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  ensureKycDocSchema: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  Network: { FIAT: "FIAT" },
  UserStatus: { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", BLOCKED: "BLOCKED" },
  prisma: {
    user: { findUnique, update: vi.fn() },
    userSession: { findMany: sessionFindMany },
    transaction: {
      groupBy,
      findFirst: txFindFirst,
      count: txCount,
      findMany: txFindMany,
    },
    wallet: { findUnique: walletFindUnique },
    auditLog: { create: auditCreate },
  },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/kycDocuments", () => ({ signKycDocumentUrl, resolveApiOrigin }));
vi.mock("@/lib/activity", () => ({ ensureActivitySchema }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradSchema, ensureKycDocSchema }));

import { GET } from "./route";

const NOW = new Date("2026-08-18T00:00:00.000Z");

/** A user row as the handler's `include` would return it. */
function userRow(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "ada@example.com",
    phone: "08031234567",
    status: "ACTIVE",
    kycTier: 1,
    createdAt: new Date("2026-07-19T00:00:00.000Z"),
    legalName: "Ada Obi",
    dateOfBirth: new Date("1990-01-02T00:00:00.000Z"),
    // The encrypted BVN is on the row; the response must not carry it.
    bvnCiphertext: "v1:SECRET-CIPHERTEXT",
    bvnFingerprint: "fp",
    bvnLast4: "8901",
    idDocType: "NIN",
    idDocNumberCiphertext: "v1:SECRET-ID",
    idDocNumberLast4: "4455",
    addressStreet: "1 Awolowo Rd",
    addressCity: "Ikoyi",
    addressState: "Lagos",
    addressPostalCode: "101233",
    mapleradCustomerId: "cus_1",
    mapleradTier: 1,
    lastSeenAt: new Date("2026-08-17T00:00:00.000Z"),
    lastIp: "102.89.1.1",
    lastDevice: "iPhone · Safari",
    lastAction: "/api/me",
    balances: [{ asset: "NGN", available: 500_00n, locked: 0n }],
    kycRecords: [
      {
        id: "k1",
        tier: 1,
        status: "APPROVED",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        documentRefs: ["kyc/u1/front.jpg", "kyc/u1/back.jpg"],
      },
    ],
    transactions: [
      {
        id: "t1",
        type: "TRANSFER_OUT",
        asset: "NGN",
        amount: 1000_00n,
        status: "COMPLETED",
        externalRef: null,
        txHash: null,
        metadata: { ip: "197.210.5.5" },
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
      },
    ],
    ...over,
  };
}

function call() {
  return GET(new Request("https://api.test/api/admin/users/u1"), {
    params: Promise.resolve({ id: "u1" }),
  });
}

describe("GET /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const m of [
      requireAdmin,
      findUnique,
      sessionFindMany,
      groupBy,
      txFindFirst,
      txCount,
      txFindMany,
      walletFindUnique,
      auditCreate,
      signKycDocumentUrl,
      resolveApiOrigin,
      ensureActivitySchema,
      ensureMapleradSchema,
      ensureKycDocSchema,
    ]) {
      m.mockReset();
    }
    requireAdmin.mockResolvedValue(undefined);
    for (const m of [ensureActivitySchema, ensureMapleradSchema, ensureKycDocSchema]) {
      m.mockResolvedValue(undefined);
    }
    findUnique.mockResolvedValue(userRow());
    sessionFindMany.mockResolvedValue([
      {
        id: "s1",
        ipAddress: "102.89.1.1",
        device: "iPhone · Safari",
        platform: "mobile",
        userAgent: "ua",
        hitCount: 12,
        firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-17T00:00:00.000Z"),
      },
      {
        id: "s2",
        ipAddress: "102.89.1.1",
        device: "Mac · Chrome",
        platform: "web",
        userAgent: "ua2",
        hitCount: 3,
        firstSeenAt: new Date("2026-08-02T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      },
    ]);
    groupBy.mockResolvedValue([
      { type: "TRANSFER_OUT", asset: "NGN", _count: { _all: 2 }, _sum: { amount: 2000_00n } },
    ]);
    txFindFirst.mockResolvedValue({ createdAt: new Date("2026-08-01T00:00:00.000Z") });
    txCount.mockResolvedValue(4);
    txFindMany.mockResolvedValue([
      { id: "t1", createdAt: new Date("2026-08-16T00:00:00.000Z"), metadata: { ip: "197.210.5.5" } },
    ]);
    walletFindUnique.mockResolvedValue({ address: "9900000001" });
    auditCreate.mockResolvedValue({});
    signKycDocumentUrl.mockImplementation((ref: string) => `https://signed/${ref}`);
    resolveApiOrigin.mockReturnValue("https://api.example.com");
  });

  it("returns the KYC details the user submitted", async () => {
    const body = await (await call()).json();

    expect(body.kyc.legalName).toBe("Ada Obi");
    expect(body.kyc.dateOfBirth).toBe("1990-01-02");
    expect(body.kyc.bvnLast4).toBe("8901");
    expect(body.kyc.idDocType).toBe("NIN");
    expect(body.kyc.idDocNumberLast4).toBe("4455");
    expect(body.kyc.address).toMatchObject({ city: "Ikoyi", state: "Lagos" });
    expect(body.kyc.documents).toEqual({
      front: "https://signed/kyc/u1/front.jpg",
      back: "https://signed/kyc/u1/back.jpg",
    });
  });

  it("never returns a full BVN or ID number, only the last four", async () => {
    // The whole number is a weightier disclosure and lives on the audited
    // compliance lookup. A regression here would leak it to every admin view.
    const raw = await (await call()).text();
    expect(raw).not.toContain("SECRET-CIPHERTEXT");
    expect(raw).not.toContain("SECRET-ID");
    expect(raw).not.toContain("bvnCiphertext");
    expect(raw).not.toContain("idDocNumberCiphertext");
  });

  it("returns devices, last login and the last transaction IP", async () => {
    const body = await (await call()).json();

    expect(body.activity.lastSeenAt).toBe("2026-08-17T00:00:00.000Z");
    expect(body.activity.lastIp).toBe("102.89.1.1");
    expect(body.activity.lastDevice).toBe("iPhone · Safari");
    expect(body.activity.lastTransactionIp).toBe("197.210.5.5");
    expect(body.activity.devices).toHaveLength(2);
    expect(body.activity.devices[0]).toMatchObject({ ipAddress: "102.89.1.1", hitCount: 12 });
  });

  it("reports no transaction IP for history recorded before IPs were kept", async () => {
    txFindMany.mockResolvedValue([
      { id: "t0", createdAt: new Date("2026-07-01T00:00:00.000Z"), metadata: {} },
    ]);
    const body = await (await call()).json();
    expect(body.activity.lastTransactionIp).toBeNull();
  });

  it("returns the three statistic groups", async () => {
    const body = await (await call()).json();

    expect(body.stats.byType[0]).toMatchObject({ type: "TRANSFER_OUT", count: 2 });
    expect(body.stats.lifecycle.accountAgeDays).toBe(30);
    expect(body.stats.lifecycle.totalTransactions).toBe(4);
    // Two device rows, but they share one IP address.
    expect(body.stats.risk.deviceCount).toBe(2);
    expect(body.stats.risk.distinctIpCount).toBe(1);
    expect(body.stats.risk.providerEnrolled).toBe(true);
    expect(body.stats.risk.depositAccountNumber).toBe("9900000001");
  });

  it("still renders when a document cannot be signed", async () => {
    signKycDocumentUrl.mockImplementation(() => { throw new Error("storage down"); });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kyc.documents).toEqual({ front: null, back: null });
  });

  it("records who viewed the record", async () => {
    await call();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "admin.user.viewed", resourceId: "u1" }),
      })
    );
  });

  it("404s for a user that does not exist", async () => {
    findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});
