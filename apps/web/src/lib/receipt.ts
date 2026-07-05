import { txnTitle, txnAmount } from "@/components/TxnRow";
import type { LedgerTransaction } from "@/services/api";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "#34C759",
  PENDING: "#F5A623",
  PROCESSING: "#F5A623",
  FAILED: "#EF4444",
  REVERSED: "#EF4444",
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 8 }) : v;
};

function detailRows(tx: LedgerTransaction): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  out.push(["Type", tx.type]);
  out.push(["Date", new Date(tx.createdAt).toLocaleString("en-NG")]);
  if (tx.fromFormatted && tx.toFormatted) {
    out.push(["From", `${num(tx.fromFormatted)} ${tx.fromAsset}`]);
    out.push(["To", `${num(tx.toFormatted)} ${tx.toAsset}`]);
  }
  if (tx.rate) out.push(["Rate", tx.rate]);
  if (tx.network) out.push(["Network", tx.network]);
  if (tx.billerName) out.push(["Biller", tx.billerName]);
  if (tx.planName) out.push(["Plan", tx.planName]);
  if (tx.customer) out.push(["Recipient", tx.customer]);
  if (Number(tx.feeFormatted) > 0) out.push(["Fee", `${num(tx.feeFormatted)} ${tx.asset}`]);
  if (tx.toAddress) out.push(["Address", tx.toAddress]);
  if (tx.txHash) out.push(["Transaction hash", tx.txHash]);
  out.push(["Reference", tx.id]);
  return out;
}

// Char-level wrap so long hashes/addresses break cleanly.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Render a branded CheqPay receipt to a PNG blob. */
export async function receiptBlob(tx: LedgerTransaction): Promise<Blob> {
  const S = 2; // retina scale
  const W = 720;
  const P = 48;
  const headerH = 150;
  const labelCol = 210;
  const valueMax = W - P * 2 - labelCol - 16;

  // Measure pass on a throwaway context.
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = "600 15px system-ui, sans-serif";
  const rows = detailRows(tx).map(([label, value]) => {
    const lines = wrap(meas, value, valueMax);
    return { label, lines, height: 18 + lines.length * 22 };
  });

  const amountBlockH = 170;
  const rowsH = rows.reduce((a, r) => a + r.height, 0);
  const footerH = 92;
  const H = headerH + amountBlockH + rowsH + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S);
  ctx.textBaseline = "alphabetic";

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header band
  ctx.fillStyle = "#6B5B95";
  ctx.fillRect(0, 0, W, headerH);
  ctx.textAlign = "center";
  ctx.font = "800 34px system-ui, sans-serif";
  const cx = W / 2;
  // "Cheq" white + "Pay" gold
  ctx.font = "800 34px system-ui, sans-serif";
  const cheqW = ctx.measureText("Cheq").width;
  const payW = ctx.measureText("Pay").width;
  const startX = cx - (cheqW + payW) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Cheq", startX, 78);
  ctx.fillStyle = "#F5C97B";
  ctx.fillText("Pay", startX + cheqW, 78);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 14px system-ui, sans-serif";
  ctx.fillText("Transaction receipt", cx, 104);

  // Amount
  const amt = txnAmount(tx);
  let y = headerH + 62;
  ctx.textAlign = "center";
  ctx.fillStyle = amt.positive ? "#159A4B" : "#14121A";
  ctx.font = "800 42px system-ui, sans-serif";
  ctx.fillText(amt.text, cx, y);
  y += 34;
  ctx.fillStyle = "#6b6b73";
  ctx.font = "500 16px system-ui, sans-serif";
  ctx.fillText(txnTitle(tx), cx, y);

  // Status pill
  y += 34;
  const status = STATUS_COLOR[tx.status] ?? "#9A93AD";
  ctx.font = "700 13px system-ui, sans-serif";
  const pillW = ctx.measureText(tx.status).width + 32;
  const pillX = cx - pillW / 2;
  ctx.fillStyle = status + "22";
  const pillY = y - 15;
  roundRect(ctx, pillX, pillY, pillW, 26, 13);
  ctx.fill();
  ctx.fillStyle = status;
  ctx.fillText(tx.status, cx, y + 3);

  // Rows
  y = headerH + amountBlockH;
  for (const r of rows) {
    ctx.strokeStyle = "#ECEAF1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, y);
    ctx.lineTo(W - P, y);
    ctx.stroke();

    const rowY = y + 30;
    ctx.textAlign = "left";
    ctx.fillStyle = "#8b8b93";
    ctx.font = "500 15px system-ui, sans-serif";
    ctx.fillText(r.label, P, rowY);

    ctx.textAlign = "right";
    ctx.fillStyle = "#14121A";
    ctx.font = "600 15px system-ui, sans-serif";
    r.lines.forEach((line, i) => {
      ctx.fillText(line, W - P, rowY + i * 22);
    });
    y += r.height;
  }

  // Footer
  ctx.textAlign = "center";
  ctx.fillStyle = "#a0a0a8";
  ctx.font = "400 13px system-ui, sans-serif";
  ctx.fillText("Generated by CheqPay · cheqpay.app", cx, H - 50);
  ctx.fillText("Keep this receipt for your records.", cx, H - 30);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Share the branded receipt image, falling back to a download. */
export async function shareReceiptImage(tx: LedgerTransaction): Promise<"shared" | "downloaded"> {
  const blob = await receiptBlob(tx);
  const file = new File([blob], `cheqpay-receipt-${tx.id.slice(0, 8)}.png`, { type: "image/png" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: "CheqPay receipt" });
      return "shared";
    } catch {
      /* fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
