import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Transaction } from "@cheqpay/db";
import {
  buildStatementCsv,
  buildStatementPdf,
  statementFilename,
  type StatementMeta,
} from "./statement";

const meta: StatementMeta = {
  name: 'Victor "V" Igwe',
  email: "victor@example.com",
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-31T23:59:59.999Z"),
};

function txn(over: Partial<Transaction>): Transaction {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "u1",
    type: "DEPOSIT",
    asset: "NGN",
    network: null,
    amount: 100_00n,
    fee: 0n,
    status: "COMPLETED",
    txHash: null,
    externalRef: null,
    idempotencyKey: "k1",
    quoteId: null,
    metadata: {},
    createdAt: new Date("2026-01-05T09:30:00.000Z"),
    updatedAt: new Date("2026-01-05T09:30:00.000Z"),
    ...over,
  } as Transaction;
}

describe("statement CSV", () => {
  it("escapes quotes so a name cannot break the row", () => {
    const csv = buildStatementCsv([], meta).toString("utf8");
    expect(csv).toContain('"Victor ""V"" Igwe"');
  });

  it("signs outbound rows negative and inbound rows positive", () => {
    const csv = buildStatementCsv(
      [
        txn({ type: "DEPOSIT", amount: 5_000_00n }),
        txn({ type: "WITHDRAWAL", amount: 1_000_00n }),
        txn({ type: "BILL", amount: 500_00n }),
      ],
      meta
    ).toString("utf8");
    expect(csv).toContain('"5000.00"');
    expect(csv).toContain('"-1000.00"');
    expect(csv).toContain('"-500.00"');
  });

  // Amounts keep the asset's full precision (BTC = 8dp), which is what a
  // statement should show — no rounding away satoshis.
  it("treats a SELL as leaving the crypto asset and a BUY as adding to it", () => {
    const csv = buildStatementCsv(
      [
        txn({ type: "SELL", asset: "BTC", amount: 50_000_000n }),
        txn({ type: "BUY", asset: "BTC", amount: 25_000_000n }),
      ],
      meta
    ).toString("utf8");
    expect(csv).toContain('"-0.50000000"');
    expect(csv).toContain('"0.25000000"');
  });

  it("reads CONVERT direction from the metadata legs", () => {
    const out = buildStatementCsv(
      [txn({ type: "CONVERT", asset: "BTC", amount: 10_000_000n, metadata: { fromAsset: "BTC" } })],
      meta
    ).toString("utf8");
    expect(out).toContain('"-0.10000000"');

    const inbound = buildStatementCsv(
      [txn({ type: "CONVERT", asset: "BTC", amount: 10_000_000n, metadata: { fromAsset: "USDT" } })],
      meta
    ).toString("utf8");
    expect(inbound).toContain('"0.10000000"');
  });

  it("includes a header row and one line per transaction", () => {
    const csv = buildStatementCsv([txn({}), txn({})], meta).toString("utf8");
    const lines = csv.split("\r\n");
    expect(lines.some((l) => l.startsWith('"Date (UTC)"'))).toBe(true);
    const headerAt = lines.findIndex((l) => l.startsWith('"Date (UTC)"'));
    expect(lines.length - headerAt - 1).toBe(2);
  });
});

describe("statement PDF", () => {
  it("produces a valid PDF even with no transactions", async () => {
    const pdf = await buildStatementPdf([], meta);
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("paginates a long statement instead of overflowing one page", async () => {
    const many = Array.from({ length: 120 }, () => txn({}));
    const pdf = await buildStatementPdf(many, meta);
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    const reloaded = await PDFDocument.load(pdf);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);
  });
});

describe("statementFilename", () => {
  it("names the file after the period and format", () => {
    expect(statementFilename(meta, "csv")).toBe("cheqpay-statement-2026-01-01-to-2026-01-31.csv");
    expect(statementFilename(meta, "pdf")).toBe("cheqpay-statement-2026-01-01-to-2026-01-31.pdf");
  });
});
