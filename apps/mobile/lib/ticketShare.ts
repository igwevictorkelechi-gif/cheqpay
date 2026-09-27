import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { EventTicket } from '@/services/api';

// Share an event ticket as a branded PDF: event, tier, date, venue, the gate
// QR code and the reference. Built the same way as the receipt (lib/receipt.ts).

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Branded HTML ticket rendered to PDF by expo-print. `qrPngBase64` is the QR as a base64 PNG. */
export function ticketHtml(t: EventTicket, qrPngBase64: string): string {
  const details = [t.tierName, whenLabel(t.startsAt), t.venue].filter((v): v is string => !!v);
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 0; color: #14121A; }
    .header { background: #6B5B95; color: #fff; padding: 36px; text-align: center; }
    .brand { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
    .brand .q { color: #F5C97B; }
    .sub { opacity: .85; margin-top: 6px; font-size: 13px; }
    .body { padding: 32px 40px 8px; text-align: center; }
    .title { font-size: 26px; font-weight: 800; margin: 0 0 10px; }
    .detail { color: #6b6b73; font-size: 15px; margin: 4px 0; }
    .cut { border-top: 2px dashed #ECEAF1; margin: 28px 40px; }
    .qr { text-align: center; }
    .qr img { width: 260px; height: 260px; }
    .ref { font-family: 'Courier New', monospace; font-weight: 700; font-size: 18px; color: #1B1726; margin-top: 14px; }
    .gate { color: #6E6880; font-size: 13px; margin-top: 4px; }
    .footer { text-align: center; color: #a0a0a8; font-size: 12px; padding: 28px 40px 40px; }
  </style></head>
  <body>
    <div class="header">
      <div class="brand">Cheq<span class="q">Pay</span></div>
      <div class="sub">Event ticket</div>
    </div>
    <div class="body">
      <p class="title">${esc(t.eventTitle)}</p>
      ${details.map((d) => `<p class="detail">${esc(d)}</p>`).join('')}
    </div>
    <div class="cut"></div>
    <div class="qr">
      <img src="data:image/png;base64,${qrPngBase64}" />
      <div class="ref">${esc(t.reference)}</div>
      <div class="gate">Show this QR code at the gate</div>
    </div>
    <div class="footer">Anyone with this QR can use the ticket once.<br/>Tickets from CheqPay · mycheqpay.com</div>
  </body></html>`;
}

/** Build the ticket PDF and open the native share sheet. */
export async function shareTicket(t: EventTicket, qrPngBase64: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: ticketHtml(t, qrPngBase64), base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Share ticket: ${t.eventTitle}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
