// apps/api/src/lib/emailTemplates.ts
//
// Transactional email templates.
//
// Why these are shaped differently rather than recoloured: an email's job is
// to be understood in the two seconds it gets in a notification shade. A
// receipt for airtime and an alert that money left the account need different
// things at the top — a token you must copy versus an amount you must
// recognise — so they are laid out differently, not tinted differently. Every
// alert looking identical is what made the old single template useless: you
// could not tell a deposit from a withdrawal without reading it.
//
// Email client constraints, which explain the unfashionable markup:
//  - Tables for layout. Outlook's engine is Word, and it does not do flexbox
//    or grid; a <div> layout collapses there.
//  - Inline styles only. Gmail strips <style> blocks in many contexts.
//  - No web fonts, no background images, no JavaScript.
//  - Hex colours in full (#ffffff, not #fff) — some clients mangle shorthand.

/** Escape anything interpolated into HTML. Every value here is user-adjacent. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** The visual identity of one kind of message. */
interface Treatment {
  /** Accent colour — the one thing that is recognisable before reading. */
  accent: string;
  /** Tinted background for the hero band. */
  wash: string;
  /** A glyph rather than an image: images are blocked by default in most clients. */
  glyph: string;
  /** Prefix for the subject line, so an inbox list is scannable. */
  subjectTag: string;
}

export type EmailKind =
  | "money_in"
  | "money_out"
  | "trade"
  | "bill"
  | "card"
  | "security"
  | "statement";

const TREATMENTS: Record<EmailKind, Treatment> = {
  // Green, amount-first: the question a deposit answers is "how much arrived".
  money_in: { accent: "#0E9F6E", wash: "#E7F7F1", glyph: "&#8595;", subjectTag: "Money in" },
  // Amber, destination-first: the question is "where did it go, and was it me".
  money_out: { accent: "#B45309", wash: "#FDF4E7", glyph: "&#8593;", subjectTag: "Money out" },
  // Purple, two-sided: a conversion is only meaningful as from → to.
  trade: { accent: "#6B5B95", wash: "#F0EDF7", glyph: "&#8646;", subjectTag: "Exchange" },
  // Blue, receipt-shaped: bills carry a token the user often must copy.
  bill: { accent: "#1D6FB8", wash: "#E8F1FA", glyph: "&#9750;", subjectTag: "Receipt" },
  // Slate, card-shaped.
  card: { accent: "#3F3D56", wash: "#EEEEF4", glyph: "&#9636;", subjectTag: "Card" },
  // Red, deliberately unlike every money email — a security notice must not
  // be mistaken for a routine receipt.
  security: { accent: "#C81E1E", wash: "#FDECEC", glyph: "&#9888;", subjectTag: "Security" },
  // Neutral: a statement is a document, not an event.
  statement: { accent: "#3F3D56", wash: "#EEEEF4", glyph: "&#9782;", subjectTag: "Statement" },
};

export interface DetailRow {
  label: string;
  value: string;
}

export interface EmailContent {
  kind: EmailKind;
  /** Short headline, e.g. "Money received". */
  title: string;
  /** One sentence of plain explanation. */
  body: string;
  /**
   * The figure to lead with, already formatted ("₦12,500.00"). Rendered as the
   * hero on money emails. Omit for security notices, which have no amount and
   * must not look like they do.
   */
  amount?: string;
  /** Supporting facts, rendered as a definition table. */
  details?: DetailRow[];
  /**
   * A value the user is expected to copy — an electricity token, a reference.
   * Given its own block in a monospace face, because burying a token in a
   * table is the single most annoying thing a bill receipt can do.
   */
  copyable?: { label: string; value: string };
  /** Optional call to action. */
  action?: { label: string; url: string };
  /** Replaces the default footer note where a message needs its own. */
  footnote?: string;
}

const BRAND_INK = "#1F1B29";
const MUTED = "#6B6880";
const BORDER = "#E4E2EC";

/** Subject line for an inbox list: tagged, so a scan separates the kinds. */
export function subjectFor(content: EmailContent): string {
  return `CheqPay ${TREATMENTS[content.kind].subjectTag}: ${content.title}`;
}

function detailTable(rows: DetailRow[]): string {
  const cells = rows
    .map(
      (d) => `
        <tr>
          <td style="padding:9px 16px 9px 0;color:${MUTED};font-size:13px;line-height:18px;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:9px 0;color:${BRAND_INK};font-size:13px;line-height:18px;font-weight:600;text-align:right;vertical-align:top;">${escapeHtml(d.value)}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:4px;">${cells}</table>`;
}

function copyBlock(accent: string, label: string, value: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:20px 0 4px;">
      <tr>
        <td style="border:1px dashed ${accent};border-radius:10px;padding:14px 16px;background-color:#FAFAFC;">
          <div style="color:${MUTED};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">${escapeHtml(label)}</div>
          <div style="color:${BRAND_INK};font-size:20px;font-weight:700;letter-spacing:0.06em;margin-top:6px;font-family:Menlo,Consolas,monospace;word-break:break-all;">${escapeHtml(value)}</div>
        </td>
      </tr>
    </table>`;
}

function actionButton(accent: string, label: string, url: string): string {
  // A table-wrapped anchor: the only button shape Outlook renders reliably.
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
      <tr>
        <td style="background-color:${accent};border-radius:999px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

/**
 * The hero band. This is the part that differs most by kind, and it is where
 * the "everything looks the same" complaint is actually answered.
 */
function hero(content: EmailContent, t: Treatment): string {
  // Security: no amount, no money framing. A warning glyph and the headline,
  // so it cannot be mistaken at a glance for a receipt.
  if (content.kind === "security") {
    return `
      <tr>
        <td style="background-color:${t.wash};padding:26px 28px;border-bottom:3px solid ${t.accent};">
          <div style="font-size:30px;line-height:30px;color:${t.accent};">${t.glyph}</div>
          <div style="margin-top:10px;color:${t.accent};font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">Security notice</div>
          <div style="margin-top:4px;color:${BRAND_INK};font-size:21px;font-weight:800;line-height:27px;">${escapeHtml(content.title)}</div>
        </td>
      </tr>`;
  }

  // Money: the amount IS the message, so it is the largest thing in the email.
  if (content.amount) {
    return `
      <tr>
        <td style="background-color:${t.wash};padding:26px 28px;border-bottom:3px solid ${t.accent};">
          <div style="color:${t.accent};font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">
            <span style="font-size:15px;">${t.glyph}</span>&nbsp;${escapeHtml(content.title)}
          </div>
          <div style="margin-top:8px;color:${BRAND_INK};font-size:34px;line-height:38px;font-weight:800;letter-spacing:-0.5px;">${escapeHtml(content.amount)}</div>
        </td>
      </tr>`;
  }

  // Everything else: a titled band, no invented figure.
  return `
    <tr>
      <td style="background-color:${t.wash};padding:24px 28px;border-bottom:3px solid ${t.accent};">
        <div style="color:${t.accent};font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">
          <span style="font-size:15px;">${t.glyph}</span>&nbsp;${escapeHtml(t.subjectTag)}
        </div>
        <div style="margin-top:6px;color:${BRAND_INK};font-size:21px;font-weight:800;line-height:27px;">${escapeHtml(content.title)}</div>
      </td>
    </tr>`;
}

/** Default footer note per kind — the reason this message exists. */
function defaultFootnote(kind: EmailKind): string {
  switch (kind) {
    case "security":
      return "If this wasn't you, change your password and your transaction PIN immediately, then contact support.";
    case "money_out":
      return "If you didn't authorise this, contact support straight away. You can change which alerts you receive under Settings › Notifications.";
    case "statement":
      return "This statement was generated at your request. You can change which alerts you receive under Settings › Notifications.";
    default:
      return "You're receiving this because transaction alerts are on for your CheqPay account. You can change which alerts you get under Settings › Notifications.";
  }
}

/**
 * Render one email.
 *
 * The outer table is fixed at 560px with a fluid inner cell — the standard
 * shape that survives Outlook, Gmail's mobile clipping and Apple Mail alike.
 */
export function renderEmail(content: EmailContent): string {
  const t = TREATMENTS[content.kind];
  const note = content.footnote ?? defaultFootnote(content.kind);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F3F8;">
  <!-- Preheader: the grey line an inbox shows after the subject. Hidden in the
       body itself, so it does not repeat the headline on screen. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.body)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F3F8;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${BORDER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td style="padding:18px 28px 0;">
              <span style="color:${BRAND_INK};font-size:17px;font-weight:800;letter-spacing:-0.3px;">CheqPay</span>
            </td>
          </tr>
          ${hero(content, t)}
          <tr>
            <td style="padding:22px 28px 26px;">
              <p style="margin:0;color:${BRAND_INK};font-size:15px;line-height:23px;">${escapeHtml(content.body)}</p>
              ${content.copyable ? copyBlock(t.accent, content.copyable.label, content.copyable.value) : ""}
              ${content.details?.length ? detailTable(content.details) : ""}
              ${content.action ? actionButton(t.accent, content.action.label, content.action.url) : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <div style="border-top:1px solid ${BORDER};padding-top:16px;color:${MUTED};font-size:12px;line-height:18px;">
                ${escapeHtml(note)}
              </div>
              <div style="margin-top:12px;color:${MUTED};font-size:12px;">&mdash; CheqPay</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Which template a notification category gets.
 *
 * Kept as an explicit map rather than inferred: "withdrawals" carries both
 * outgoing payouts and outgoing transfers, and a future category must be a
 * decision here rather than silently defaulting to a money template it does
 * not suit.
 */
export function kindForCategory(category: string): EmailKind {
  switch (category) {
    case "deposits":
      return "money_in";
    case "withdrawals":
      return "money_out";
    case "trades":
      return "trade";
    case "bills":
      return "bill";
    case "security":
      return "security";
    default:
      // price / promos and anything added later: neutral, no money framing.
      return "statement";
  }
}
