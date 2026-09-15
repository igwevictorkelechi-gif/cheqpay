import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  kindForCategory,
  renderEmail,
  subjectFor,
  type EmailKind,
} from "./emailTemplates";

const ALL_KINDS: EmailKind[] = [
  "money_in",
  "money_out",
  "trade",
  "bill",
  "card",
  "security",
  "statement",
];

describe("renderEmail", () => {
  it("renders a complete HTML document", () => {
    const html = renderEmail({ kind: "money_in", title: "Money received", body: "You got paid." });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).toContain("Money received");
    expect(html).toContain("You got paid.");
  });

  /**
   * The whole point of this module: an inbox must be able to tell these apart.
   * If two kinds ever render the same bytes for the same content, the feature
   * has silently regressed to the single template it replaced.
   */
  it("gives every kind a visually distinct rendering", () => {
    const rendered = ALL_KINDS.map((kind) =>
      renderEmail({ kind, title: "Something happened", body: "Details here.", amount: "₦1,000.00" }),
    );
    expect(new Set(rendered).size).toBe(ALL_KINDS.length);
  });

  it("tags subjects by kind so an inbox list is scannable", () => {
    expect(subjectFor({ kind: "money_in", title: "Money received", body: "" })).toBe(
      "CheqPay Money in: Money received",
    );
    expect(subjectFor({ kind: "security", title: "New sign-in", body: "" })).toBe(
      "CheqPay Security: New sign-in",
    );
  });

  it("leads with the amount when there is one", () => {
    const html = renderEmail({
      kind: "money_in",
      title: "Money received",
      body: "Sent by @ada.",
      amount: "₦12,500.00",
    });
    expect(html).toContain("₦12,500.00");
  });

  /**
   * A security notice must not look like a receipt. It carries no amount, so
   * it must not render the money hero even if one were passed by mistake.
   */
  it("never renders a money hero on a security notice", () => {
    const html = renderEmail({
      kind: "security",
      title: "New sign-in",
      body: "From a new device.",
      amount: "₦999.00",
    });
    expect(html).toContain("Security notice");
    expect(html).not.toContain("₦999.00");
  });

  it("gives a copyable value its own block", () => {
    const html = renderEmail({
      kind: "bill",
      title: "Bill paid",
      body: "Ikeja Electric.",
      copyable: { label: "Recharge token", value: "1234-5678-9012-3456" },
    });
    expect(html).toContain("Recharge token");
    expect(html).toContain("1234-5678-9012-3456");
    expect(html).toContain("monospace");
  });

  it("renders detail rows and an action button", () => {
    const html = renderEmail({
      kind: "money_out",
      title: "Money sent",
      body: "To @ada.",
      details: [{ label: "To", value: "@ada" }],
      action: { label: "View receipt", url: "https://mycheqpay.com/transactions" },
    });
    expect(html).toContain("@ada");
    expect(html).toContain("View receipt");
    expect(html).toContain("https://mycheqpay.com/transactions");
  });

  // Every interpolated value is user-adjacent — a username, a transfer note,
  // a biller name off a provider. None of it may become markup.
  it("escapes every interpolated value", () => {
    const html = renderEmail({
      kind: "money_out",
      title: '<script>alert("t")</script>',
      body: "<img src=x onerror=alert(1)>",
      amount: "<b>₦1</b>",
      details: [{ label: "<i>k</i>", value: "<i>v</i>" }],
      copyable: { label: "<u>l</u>", value: "<u>v</u>" },
      action: { label: "<s>go</s>", url: 'https://x.test/"onmouseover="alert(1)' },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>₦1</b>");
    expect(html).not.toContain("<i>v</i>");
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses a kind-appropriate footer", () => {
    const security = renderEmail({ kind: "security", title: "t", body: "b" });
    expect(security).toContain("change your password");
    const deposit = renderEmail({ kind: "money_in", title: "t", body: "b" });
    expect(deposit).toContain("transaction alerts are on");
  });

  it("honours an explicit footnote", () => {
    const html = renderEmail({ kind: "bill", title: "t", body: "b", footnote: "Custom note." });
    expect(html).toContain("Custom note.");
  });
});

describe("kindForCategory", () => {
  it("maps money categories to their own templates", () => {
    expect(kindForCategory("deposits")).toBe("money_in");
    expect(kindForCategory("withdrawals")).toBe("money_out");
    expect(kindForCategory("trades")).toBe("trade");
    expect(kindForCategory("bills")).toBe("bill");
    expect(kindForCategory("security")).toBe("security");
  });

  // A category with no money meaning must not borrow a money template, or it
  // would render as though an amount were missing rather than absent.
  it("falls back to a neutral template for non-money categories", () => {
    expect(kindForCategory("price")).toBe("statement");
    expect(kindForCategory("promos")).toBe("statement");
    expect(kindForCategory("something_added_later")).toBe("statement");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
