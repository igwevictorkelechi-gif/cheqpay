# Supabase Auth email templates

These are the account emails — sign-up, sign-in code, password reset. They are
sent by **Supabase**, not by this codebase, which is why they arrived looking
nothing like the rest of the product and identical to each other.

They are generated from the same module as the in-app emails
(`apps/api/src/lib/emailTemplates.ts`), so the sign-in code and a deposit
receipt now look like they come from the same company.

## How to apply them

1. Supabase dashboard → **Authentication** → **Emails** → **Templates**.
2. For each row below, open that template, paste the file's contents into the
   message body, and set the subject.
3. Save. Send yourself one of each to confirm.

| Supabase template | File | Subject to set |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your CheqPay account |
| Magic Link | `magic-link.html` | Your CheqPay sign-in link |
| Magic Link / OTP (code variant) | `login-code.html` | Your CheqPay sign-in code |
| Reset Password | `reset-password.html` | Reset your CheqPay password |
| Change Email Address | `change-email.html` | Confirm your new CheqPay email |
| Reauthentication | `reauthentication.html` | Your CheqPay verification code |

## Regenerating

```bash
cd apps/api && npx tsx scripts/generate-supabase-templates.ts
```

Edit `scripts/generate-supabase-templates.ts` — not these HTML files — or the
next run will overwrite your changes.

## Note on the codes

`{{ .Token }}` and `{{ .ConfirmationURL }}` are Supabase's own placeholders.
They are substituted when the mail is sent; leave them exactly as they are.

Two of these deliberately use the **security** treatment (red, warning glyph,
no money framing) rather than the neutral one: a password reset and an email
change are the two strongest signals of an account takeover, and they must not
read as routine notifications.
