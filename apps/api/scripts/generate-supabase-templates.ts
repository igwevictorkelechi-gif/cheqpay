/**
 * Generate the Supabase Auth email templates.
 *
 * Supabase sends the account emails — sign-up confirmation, the login code,
 * password reset — from ITS OWN templates, configured in the dashboard rather
 * than in this repo. That is why every one of them arrives looking identical
 * and unlike the rest of the product: they are all the stock Supabase layout.
 *
 * Rather than hand-maintain a second set of HTML, this renders them through
 * the same lib/emailTemplates module the in-app alerts use, so the login code
 * and the deposit receipt look like they come from the same company — and so
 * a change to the shell reaches both.
 *
 * Run:  npx tsx scripts/generate-supabase-templates.ts
 * Then: paste each file into Supabase → Authentication → Emails.
 *
 * Supabase's own placeholders ({{ .Token }}, {{ .ConfirmationURL }}) pass
 * through the HTML escaper untouched — they contain no escapable characters —
 * so they survive into the output verbatim and Supabase substitutes them at
 * send time.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, type EmailContent } from "../src/lib/emailTemplates";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "email-templates");

interface Template {
  /** Output filename. */
  file: string;
  /** Which Supabase template this is, for the README. */
  supabaseName: string;
  /** The subject to set alongside it in the dashboard. */
  subject: string;
  content: EmailContent;
}

const TEMPLATES: Template[] = [
  {
    file: "confirm-signup.html",
    supabaseName: "Confirm signup",
    subject: "Confirm your CheqPay account",
    content: {
      kind: "statement",
      title: "Confirm your email",
      body: "Welcome to CheqPay. Confirm this address to finish setting up your account — it's how we reach you about your money.",
      action: { label: "Confirm my email", url: "{{ .ConfirmationURL }}" },
      footnote:
        "If you didn't create a CheqPay account, you can ignore this email and nothing will happen.",
    },
  },
  {
    file: "magic-link.html",
    supabaseName: "Magic Link",
    subject: "Your CheqPay sign-in link",
    content: {
      kind: "statement",
      title: "Sign in to CheqPay",
      body: "Use the link below to sign in. It works once and expires shortly.",
      action: { label: "Sign in", url: "{{ .ConfirmationURL }}" },
      footnote:
        "If you didn't ask to sign in, ignore this email and consider changing your password.",
    },
  },
  {
    file: "login-code.html",
    supabaseName: "Magic Link / OTP (code variant)",
    subject: "Your CheqPay sign-in code",
    content: {
      kind: "statement",
      title: "Your sign-in code",
      body: "Enter this code to sign in. It expires in a few minutes and can only be used once.",
      copyable: { label: "Sign-in code", value: "{{ .Token }}" },
      footnote:
        "CheqPay will never ask you for this code by phone, SMS or WhatsApp. If someone is asking you for it, they are trying to take your money.",
    },
  },
  {
    file: "reset-password.html",
    supabaseName: "Reset Password",
    subject: "Reset your CheqPay password",
    content: {
      // Security treatment, deliberately unlike the sign-in code: a reset the
      // user did not ask for is the single strongest signal of an account
      // takeover attempt, and it must not read as routine.
      kind: "security",
      title: "Reset your password",
      body: "Someone asked to reset the password on your CheqPay account. If it was you, use the button below. The link works once and expires shortly.",
      action: { label: "Reset my password", url: "{{ .ConfirmationURL }}" },
      footnote:
        "If you did NOT request this, do not use the link. Your password has not changed. Sign in and change it anyway, and contact support.",
    },
  },
  {
    file: "change-email.html",
    supabaseName: "Change Email Address",
    subject: "Confirm your new CheqPay email",
    content: {
      kind: "security",
      title: "Confirm your new email address",
      body: "You asked to change the email address on your CheqPay account to this one. Confirm it to complete the change.",
      action: { label: "Confirm this address", url: "{{ .ConfirmationURL }}" },
      footnote:
        "If you did not request this change, contact support immediately — someone may be trying to take over your account.",
    },
  },
  {
    file: "reauthentication.html",
    supabaseName: "Reauthentication",
    subject: "Your CheqPay verification code",
    content: {
      kind: "security",
      title: "Confirm it's you",
      body: "Enter this code to confirm a sensitive change to your account.",
      copyable: { label: "Verification code", value: "{{ .Token }}" },
      footnote:
        "CheqPay will never ask you for this code by phone, SMS or WhatsApp. If you did not request it, someone has your password — change it now.",
    },
  },
];

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const t of TEMPLATES) {
    writeFileSync(join(OUT_DIR, t.file), renderEmail(t.content), "utf8");
  }

  const readme = `# Supabase Auth email templates

These are the account emails — sign-up, sign-in code, password reset. They are
sent by **Supabase**, not by this codebase, which is why they arrived looking
nothing like the rest of the product and identical to each other.

They are generated from the same module as the in-app emails
(\`apps/api/src/lib/emailTemplates.ts\`), so the sign-in code and a deposit
receipt now look like they come from the same company.

## How to apply them

1. Supabase dashboard → **Authentication** → **Emails** → **Templates**.
2. For each row below, open that template, paste the file's contents into the
   message body, and set the subject.
3. Save. Send yourself one of each to confirm.

| Supabase template | File | Subject to set |
|---|---|---|
${TEMPLATES.map((t) => `| ${t.supabaseName} | \`${t.file}\` | ${t.subject} |`).join("\n")}

## Regenerating

\`\`\`bash
cd apps/api && npx tsx scripts/generate-supabase-templates.ts
\`\`\`

Edit \`scripts/generate-supabase-templates.ts\` — not these HTML files — or the
next run will overwrite your changes.

## Note on the codes

\`{{ .Token }}\` and \`{{ .ConfirmationURL }}\` are Supabase's own placeholders.
They are substituted when the mail is sent; leave them exactly as they are.

Two of these deliberately use the **security** treatment (red, warning glyph,
no money framing) rather than the neutral one: a password reset and an email
change are the two strongest signals of an account takeover, and they must not
read as routine notifications.
`;
  writeFileSync(join(OUT_DIR, "README.md"), readme, "utf8");

  console.log(`Wrote ${TEMPLATES.length} templates + README to ${OUT_DIR}`);
}

main();
