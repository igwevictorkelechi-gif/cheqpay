// Share an event ticket as a branded image: event, tier, date, venue, the gate
// QR code and the ticket reference. Drawn on a canvas in the same style as the
// transaction receipt (lib/receipt.ts), then handed to the phone's share sheet.

import type { EventTicket } from "@/services/api";

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString("en-NG", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString().replace("T", " ").slice(0, 16);
  }
}

/** The line that goes with the image in the share sheet. */
export function ticketShareText(t: EventTicket): string {
  return `Your ticket for ${t.eventTitle} (${t.tierName}) — show the QR code at the gate. Anyone with this QR can use the ticket once.`;
}

// Wrap text to a width, breaking on spaces (event titles can be long).
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

/** Load the ticket card's own QR (an <svg>) as an image the canvas can draw. */
function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not draw the QR code"));
    img.src = src;
  });
}

/** Render a branded ticket to a PNG blob. */
export async function ticketBlob(t: EventTicket, qrSvg: SVGSVGElement): Promise<Blob> {
  const S = 2; // retina scale
  const W = 720;
  const P = 48;
  const headerH = 140;
  const qrSize = 300;

  const qr = await svgToImage(qrSvg);

  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = "800 30px system-ui, sans-serif";
  const titleLines = wrapWords(meas, t.eventTitle, W - P * 2);
  const when = whenLabel(t.startsAt);
  const details = [t.tierName, when, t.venue].filter((v): v is string => !!v);

  const infoH = 40 + titleLines.length * 38 + details.length * 28 + 24;
  const qrBlockH = qrSize + 110;
  const footerH = 80;
  const H = headerH + infoH + qrBlockH + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header band: "Cheq" white + "Pay" gold, as on the receipt.
  const cx = W / 2;
  ctx.fillStyle = "#6B5B95";
  ctx.fillRect(0, 0, W, headerH);
  ctx.font = "800 34px system-ui, sans-serif";
  const cheqW = ctx.measureText("Cheq").width;
  const payW = ctx.measureText("Pay").width;
  const startX = cx - (cheqW + payW) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Cheq", startX, 74);
  ctx.fillStyle = "#F5C97B";
  ctx.fillText("Pay", startX + cheqW, 74);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 14px system-ui, sans-serif";
  ctx.fillText("Event ticket", cx, 100);

  // Event details
  let y = headerH + 56;
  ctx.fillStyle = "#14121A";
  ctx.font = "800 30px system-ui, sans-serif";
  for (const line of titleLines) {
    ctx.fillText(line, cx, y);
    y += 38;
  }
  ctx.fillStyle = "#6b6b73";
  ctx.font = "500 17px system-ui, sans-serif";
  for (const d of details) {
    ctx.fillText(d, cx, y);
    y += 28;
  }

  // Divider with ticket notches
  y = headerH + infoH;
  ctx.strokeStyle = "#ECEAF1";
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(P, y);
  ctx.lineTo(W - P, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#F3F1F7";
  ctx.beginPath();
  ctx.arc(0, y, 18, 0, Math.PI * 2);
  ctx.arc(W, y, 18, 0, Math.PI * 2);
  ctx.fill();

  // QR + reference
  const qrY = y + 36;
  ctx.drawImage(qr, cx - qrSize / 2, qrY, qrSize, qrSize);
  ctx.fillStyle = "#1B1726";
  ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(t.reference, cx, qrY + qrSize + 40);
  ctx.fillStyle = "#6E6880";
  ctx.font = "500 14px system-ui, sans-serif";
  ctx.fillText("Show this QR code at the gate", cx, qrY + qrSize + 64);

  // Footer
  ctx.fillStyle = "#a0a0a8";
  ctx.font = "400 13px system-ui, sans-serif";
  ctx.fillText("Anyone with this QR can use the ticket once.", cx, H - 44);
  ctx.fillText("Tickets from CheqPay · mycheqpay.com", cx, H - 24);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png"),
  );
}

/**
 * Open the share sheet with the ticket image. "cancelled" when the person
 * closed the sheet (not an error); "downloaded" where the browser can't share
 * files, so the image is saved instead.
 */
export async function shareTicketImage(
  t: EventTicket,
  qrSvg: SVGSVGElement,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await ticketBlob(t, qrSvg);
  const file = new File([blob], `cheqpay-ticket-${t.reference}.png`, { type: "image/png" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: `Ticket: ${t.eventTitle}`, text: ticketShareText(t) });
      return "shared";
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
      /* anything else: fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "downloaded";
}
