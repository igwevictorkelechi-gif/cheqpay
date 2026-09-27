import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("@cheqpay/db", () => ({ prisma: { $executeRawUnsafe: h.exec } }));

import { ensureGadgetSchema } from "./ensureGadgets";

beforeEach(() => {
  h.exec.mockReset();
  h.exec.mockResolvedValue(0);
});

describe("ensureGadgetSchema", () => {
  it("creates the order-status enum and converts a text status column to it", async () => {
    await ensureGadgetSchema();
    const sql = h.exec.mock.calls.map((c) => String(c[0])).join("\n");
    // Without the type, every order insert failed in production.
    expect(sql).toContain(`CREATE TYPE "GadgetOrderStatus" AS ENUM`);
    expect(sql).toMatch(/'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'/);
    expect(sql).toContain(`ALTER COLUMN status TYPE "GadgetOrderStatus" USING status::"GadgetOrderStatus"`);
    // Only while the column is still text, so re-running is a no-op.
    expect(sql).toContain("data_type = 'text'");
    // The type exists before the column conversion refers to it.
    expect(sql.indexOf(`CREATE TYPE "GadgetOrderStatus"`)).toBeLessThan(sql.indexOf(`TYPE "GadgetOrderStatus" USING`));
  });
});
