import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Transaction } from "@cheqpay/db";
import { fromMinorUnits } from "./money";

/**
 * Account statement documents. Rows come straight from the ledger, so a
 * statement is always reproducible from ledger_transactions — nothing is
 * derived or rounded here beyond formatting minor units into decimal strings.
 */

export type StatementFormat = "pdf" | "csv";

export interface StatementMeta {
  name: string;
  email: string;
  from: Date;
  to: Date;
}

/** dd MMM yyyy — unambiguous for NG readers, no locale dependency. */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtDateTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(d)} ${hh}:${mm} UTC`;
}

/**
 * Signed amount for the row's own asset — a balance leaving the wallet reads
 * negative. BUY/SELL/CONVERT rows record the CRYPTO leg (see lib/swap.ts), so
 * a SELL reduces that asset while a BUY adds to it. A CONVERT can go either
 * way, so its direction is read from the metadata legs rather than assumed.
 */
function signedAmount(t: Transaction): string {
  const value = fromMinorUnits(t.amount, t.asset);
  let outbound: boolean;
  switch (t.type) {
    case "WITHDRAWAL":
    case "BILL":
    case "SELL":
      outbound = true;
      break;
    case "CONVERT": {
      const meta = (t.metadata ?? {}) as { fromAsset?: string };
      outbound = meta.fromAsset === t.asset;
      break;
    }
    default: // DEPOSIT, BUY
      outbound = false;
  }
  return outbound ? `-${value}` : value;
}

const HEADERS = ["Date (UTC)", "Type", "Asset", "Amount", "Fee", "Status", "Reference"];

function rowsFor(txns: Transaction[]): string[][] {
  return txns.map((t) => [
    fmtDateTime(t.createdAt),
    t.type,
    t.asset,
    signedAmount(t),
    fromMinorUnits(t.fee, t.asset),
    t.status,
    t.txHash ?? t.externalRef ?? t.id,
  ]);
}

/** RFC 4180: quote every field and double any embedded quote. */
export function buildStatementCsv(txns: Transaction[], meta: StatementMeta): Buffer {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    [`CheqPay account statement`].map(esc).join(","),
    [`Account`, meta.name].map(esc).join(","),
    [`Email`, meta.email].map(esc).join(","),
    [`Period`, `${fmtDate(meta.from)} to ${fmtDate(meta.to)}`].map(esc).join(","),
    [`Transactions`, String(txns.length)].map(esc).join(","),
    "",
    HEADERS.map(esc).join(","),
    ...rowsFor(txns).map((r) => r.map(esc).join(",")),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

// A4 landscape gives the seven columns room without shrinking the type.
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 40;
const COL_X = [40, 165, 250, 315, 430, 520, 610];
const BRAND = rgb(0.42, 0.357, 0.584); // #6B5B95

export async function buildStatementPdf(
  txns: Transaction[],
  meta: StatementMeta
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`CheqPay statement — ${fmtDate(meta.from)} to ${fmtDate(meta.to)}`);
  pdf.setCreator("CheqPay");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const rows = rowsFor(txns);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = 0;

  /** Draw the masthead on the first page and a header row on every page. */
  const startPage = (first: boolean) => {
    y = PAGE_H - MARGIN;
    if (first) {
      page.drawText("CheqPay", { x: MARGIN, y: y - 6, size: 20, font: bold, color: BRAND });
      page.drawText("Account statement", { x: MARGIN, y: y - 26, size: 11, font });
      const right = `${fmtDate(meta.from)}  —  ${fmtDate(meta.to)}`;
      page.drawText(right, {
        x: PAGE_W - MARGIN - bold.widthOfTextAtSize(right, 10),
        y: y - 6,
        size: 10,
        font: bold,
      });
      page.drawText(meta.name, {
        x: PAGE_W - MARGIN - font.widthOfTextAtSize(meta.name, 9),
        y: y - 22,
        size: 9,
        font,
      });
      page.drawText(meta.email, {
        x: PAGE_W - MARGIN - font.widthOfTextAtSize(meta.email, 9),
        y: y - 34,
        size: 9,
        font,
      });
      y -= 58;
    }
    // Header band
    page.drawRectangle({
      x: MARGIN - 6,
      y: y - 16,
      width: PAGE_W - (MARGIN - 6) * 2,
      height: 20,
      color: rgb(0.94, 0.93, 0.96),
    });
    HEADERS.forEach((h, i) => {
      page.drawText(h, { x: COL_X[i], y: y - 11, size: 9, font: bold, color: BRAND });
    });
    y -= 30;
  };

  startPage(true);

  if (rows.length === 0) {
    page.drawText("No transactions in this period.", { x: MARGIN, y, size: 10, font });
  }

  for (const row of rows) {
    if (y < MARGIN + 30) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      startPage(false);
    }
    row.forEach((cell, i) => {
      // Clip long references to the column width rather than overlapping.
      const max = (COL_X[i + 1] ?? PAGE_W - MARGIN) - COL_X[i] - 8;
      let text = cell;
      while (text.length > 4 && font.widthOfTextAtSize(text, 9) > max) {
        text = text.slice(0, -2);
      }
      if (text !== cell) text = `${text}…`;
      page.drawText(text, { x: COL_X[i], y, size: 9, font });
    });
    y -= 16;
  }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `${txns.length} transaction${txns.length === 1 ? "" : "s"}  ·  Generated ${fmtDateTime(new Date())}  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: MARGIN, y: 22, size: 8, font, color: rgb(0.45, 0.45, 0.5) });
  });

  return Buffer.from(await pdf.save());
}

/** Filename shown in the user's inbox. */
export function statementFilename(meta: StatementMeta, format: StatementFormat): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return `cheqpay-statement-${iso(meta.from)}-to-${iso(meta.to)}.${format}`;
}
